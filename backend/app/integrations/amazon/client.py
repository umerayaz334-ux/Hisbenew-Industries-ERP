"""Small, safe SP-API HTTP client used by the connection test."""

from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from time import monotonic, sleep
from urllib.parse import quote

import requests

from .auth import get_lwa_access_token
from .constants import (
    FBA_INBOUND_LEGACY_PATH,
    FBA_INBOUND_PATH,
    FINANCES_EVENT_GROUPS_PATH,
    FINANCES_TRANSACTIONS_PATH,
    FBA_INVENTORY_SUMMARIES_PATH,
    LISTINGS_ITEMS_PATH,
    ORDERS_PATH,
    SELLERS_MARKETPLACE_PARTICIPATIONS_PATH,
    SP_API_USER_AGENT,
)
from .exceptions import (
    AmazonAuthorizationError,
    AmazonIntegrationError,
    AmazonPermissionError,
    AmazonRateLimitError,
    AmazonTemporaryError,
)
from .models import AmazonAccount


@dataclass(frozen=True)
class ConnectionTestResult:
    marketplace_ids: tuple[str, ...]
    amazon_request_id: str | None
    http_status: int
    duration_ms: int


@dataclass(frozen=True)
class SpApiJsonResult:
    body: dict
    amazon_request_id: str | None
    http_status: int
    duration_ms: int


def _retry_delay(response: requests.Response | None, attempt: int) -> float:
    if response is not None:
        retry_after = response.headers.get("retry-after", "").strip()
        if retry_after:
            try:
                return min(5.0, max(0.0, float(retry_after)))
            except ValueError:
                try:
                    retry_date = parsedate_to_datetime(retry_after)
                    return min(
                        5.0,
                        max(0.0, (retry_date - datetime.now(retry_date.tzinfo)).total_seconds()),
                    )
                except (TypeError, ValueError, OverflowError):
                    pass
    return min(2.0, 0.5 * (2**attempt))


def _safe_amazon_error_code(response: requests.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"http_{response.status_code}"
    errors = body.get("errors") if isinstance(body, dict) else None
    if isinstance(errors, list) and errors and isinstance(errors[0], dict):
        code = str(errors[0].get("code") or "").strip()
        if code:
            return code[:100]
    return f"http_{response.status_code}"


class AmazonSpApiClient:
    def __init__(self, account: AmazonAccount) -> None:
        self.account = account

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json_body: dict | None = None,
        maximum_attempts: int = 3,
        permission_message: str = (
            "The Amazon application is missing permission for this API."
        ),
    ) -> requests.Response:
        last_error: AmazonIntegrationError | None = None
        for attempt in range(maximum_attempts):
            access_token = get_lwa_access_token(
                self.account,
                force_refresh=attempt > 0 and isinstance(last_error, AmazonAuthorizationError),
            )
            started_at = monotonic()
            response = None
            try:
                response = requests.request(
                    method,
                    f"{self.account.endpoint.rstrip('/')}{path}",
                    params=params,
                    json=json_body,
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "User-Agent": SP_API_USER_AGENT,
                        "x-amz-access-token": access_token.value,
                        "x-amz-date": datetime.utcnow().strftime("%Y%m%dT%H%M%SZ"),
                    },
                    timeout=(5, 20),
                )
            except requests.Timeout as exc:
                last_error = AmazonTemporaryError(
                    "Amazon SP-API timed out. Please try again.",
                    error_code="sp_api_timeout",
                    duration_ms=int((monotonic() - started_at) * 1000),
                )
                if attempt + 1 < maximum_attempts:
                    sleep(_retry_delay(None, attempt))
                    continue
                raise last_error from exc
            except requests.RequestException as exc:
                last_error = AmazonTemporaryError(
                    "Amazon SP-API is temporarily unreachable.",
                    error_code="sp_api_unreachable",
                    duration_ms=int((monotonic() - started_at) * 1000),
                )
                if attempt + 1 < maximum_attempts:
                    sleep(_retry_delay(None, attempt))
                    continue
                raise last_error from exc

            duration_ms = int((monotonic() - started_at) * 1000)
            request_id = response.headers.get("x-amzn-requestid")
            code = _safe_amazon_error_code(response)
            if response.status_code < 400:
                response.amazon_duration_ms = duration_ms
                return response
            if response.status_code == 401:
                last_error = AmazonAuthorizationError(
                    "Amazon authorization has expired or is no longer valid.",
                    error_code=code,
                    http_status=response.status_code,
                    amazon_request_id=request_id,
                    duration_ms=duration_ms,
                )
            elif response.status_code == 403:
                raise AmazonPermissionError(
                    permission_message,
                    error_code=code,
                    http_status=response.status_code,
                    amazon_request_id=request_id,
                    duration_ms=duration_ms,
                )
            elif response.status_code == 429:
                last_error = AmazonRateLimitError(
                    "Amazon rate-limited the connection test. Please try again shortly.",
                    error_code=code,
                    http_status=response.status_code,
                    amazon_request_id=request_id,
                    duration_ms=duration_ms,
                )
            elif response.status_code in {500, 502, 503, 504}:
                last_error = AmazonTemporaryError(
                    "Amazon SP-API is temporarily unavailable.",
                    error_code=code,
                    http_status=response.status_code,
                    amazon_request_id=request_id,
                    duration_ms=duration_ms,
                )
            else:
                raise AmazonIntegrationError(
                    "Amazon rejected the connection test request.",
                    error_code=code,
                    http_status=response.status_code,
                    amazon_request_id=request_id,
                    duration_ms=duration_ms,
                )

            if attempt + 1 < maximum_attempts:
                sleep(_retry_delay(response, attempt))
                continue
            raise last_error

        raise AmazonTemporaryError(
            "Amazon SP-API could not complete the request.",
            error_code="sp_api_attempts_exhausted",
        )

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json_body: dict | None = None,
        permission_message: str,
    ) -> SpApiJsonResult:
        response = self._request(
            method,
            path,
            params=params,
            json_body=json_body,
            permission_message=permission_message,
        )
        request_id = response.headers.get("x-amzn-requestid")
        duration_ms = int(getattr(response, "amazon_duration_ms", 0))
        try:
            body = response.json() if response.content else {}
        except ValueError as exc:
            raise AmazonTemporaryError(
                "Amazon returned an invalid JSON response.",
                error_code="amazon_invalid_response",
                http_status=response.status_code,
                amazon_request_id=request_id,
                duration_ms=duration_ms,
            ) from exc
        if not isinstance(body, dict):
            raise AmazonTemporaryError(
                "Amazon returned an invalid response.",
                error_code="amazon_invalid_response",
                http_status=response.status_code,
                amazon_request_id=request_id,
                duration_ms=duration_ms,
            )
        return SpApiJsonResult(
            body=body,
            amazon_request_id=request_id,
            http_status=response.status_code,
            duration_ms=duration_ms,
        )

    def _get(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
        maximum_attempts: int = 3,
        permission_message: str = (
            "The Amazon application is missing permission for this API."
        ),
    ) -> requests.Response:
        return self._request(
            "GET",
            path,
            params=params,
            maximum_attempts=maximum_attempts,
            permission_message=permission_message,
        )

    def _get_json(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
        permission_message: str,
    ) -> SpApiJsonResult:
        return self._request_json(
            "GET",
            path,
            params=params,
            permission_message=permission_message,
        )

    def _post_json(
        self,
        path: str,
        *,
        json_body: dict | None = None,
        permission_message: str,
    ) -> SpApiJsonResult:
        return self._request_json(
            "POST",
            path,
            json_body=json_body,
            permission_message=permission_message,
        )

    def _put_json(
        self,
        path: str,
        *,
        json_body: dict | None = None,
        permission_message: str,
    ) -> SpApiJsonResult:
        return self._request_json(
            "PUT",
            path,
            json_body=json_body,
            permission_message=permission_message,
        )

    def _patch_json(
        self,
        path: str,
        *,
        params: dict[str, object] | None = None,
        json_body: dict | None = None,
        permission_message: str,
    ) -> SpApiJsonResult:
        return self._request_json(
            "PATCH",
            path,
            params=params,
            json_body=json_body,
            permission_message=permission_message,
        )

    def search_listing_items(
        self,
        seller_id: str,
        *,
        page_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {
            "marketplaceIds": self.account.marketplace_id,
            "issueLocale": "en_US",
            "includedData": (
                "summaries,attributes,issues,offers,fulfillmentAvailability"
            ),
            "pageSize": 20,
            "sortBy": "sku",
            "sortOrder": "ASC",
        }
        if page_token:
            params["pageToken"] = page_token
        return self._get_json(
            f"{LISTINGS_ITEMS_PATH}/{quote(seller_id, safe='')}",
            params=params,
            permission_message=(
                "The Amazon application is missing the Product Listing permission."
            ),
        )

    def get_listing_item(
        self,
        seller_id: str,
        seller_sku: str,
    ) -> SpApiJsonResult:
        return self._get_json(
            (
                f"{LISTINGS_ITEMS_PATH}/{quote(seller_id, safe='')}/"
                f"{quote(seller_sku, safe='')}"
            ),
            params={
                "marketplaceIds": self.account.marketplace_id,
                "issueLocale": "en_US",
                "includedData": (
                    "summaries,attributes,issues,offers,fulfillmentAvailability"
                ),
            },
            permission_message=(
                "The Amazon application is missing the Product Listing permission."
            ),
        )

    def patch_listing_price(
        self,
        seller_id: str,
        seller_sku: str,
        *,
        payload: dict,
    ) -> SpApiJsonResult:
        return self._patch_json(
            (
                f"{LISTINGS_ITEMS_PATH}/{quote(seller_id, safe='')}/"
                f"{quote(seller_sku, safe='')}"
            ),
            params={
                "marketplaceIds": self.account.marketplace_id,
                "issueLocale": "en_US",
            },
            json_body=payload,
            permission_message=(
                "The Amazon application is missing the Product Listing "
                "permission required to update prices."
            ),
        )

    def get_fba_inventory_summaries(
        self,
        *,
        next_token: str | None = None,
        seller_sku: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {
            "details": "true",
            "granularityType": "Marketplace",
            "granularityId": self.account.marketplace_id,
            "marketplaceIds": self.account.marketplace_id,
        }
        if next_token:
            params["nextToken"] = next_token
        if seller_sku:
            params["sellerSku"] = seller_sku
        return self._get_json(
            FBA_INVENTORY_SUMMARIES_PATH,
            params=params,
            permission_message=(
                "The Amazon application is missing the Amazon Fulfillment "
                "or Product Listing permission required for FBA inventory."
            ),
        )

    def search_fba_orders(
        self,
        *,
        created_after: str | None = None,
        last_updated_after: str | None = None,
        pagination_token: str | None = None,
    ) -> SpApiJsonResult:
        if bool(created_after) == bool(last_updated_after):
            raise ValueError(
                "Provide exactly one Amazon order synchronization cursor."
            )
        params: dict[str, object] = {
            "marketplaceIds": self.account.marketplace_id,
            "fulfilledBy": "AMAZON",
            "maxResultsPerPage": 100,
            "includedData": (
                "PROCEEDS,FULFILLMENT,PROMOTION,CANCELLATION"
            ),
        }
        if created_after:
            params["createdAfter"] = created_after
        else:
            params["lastUpdatedAfter"] = last_updated_after
        if pagination_token:
            params["paginationToken"] = pagination_token
        return self._get_json(
            ORDERS_PATH,
            params=params,
            permission_message=(
                "The Amazon application is missing a role required for "
                "the Orders API."
            ),
        )

    def get_fba_order(self, amazon_order_id: str) -> SpApiJsonResult:
        return self._get_json(
            f"{ORDERS_PATH}/{quote(amazon_order_id, safe='')}",
            params={
                "includedData": (
                    "PROCEEDS,FULFILLMENT,PROMOTION,CANCELLATION"
                ),
            },
            permission_message=(
                "The Amazon application is missing a role required for "
                "the Orders API."
            ),
        )

    def list_financial_transactions(
        self,
        *,
        posted_after: str | None = None,
        posted_before: str | None = None,
        next_token: str | None = None,
        transaction_status: str | None = None,
    ) -> SpApiJsonResult:
        if not posted_after:
            raise ValueError("posted_after is required for a finance sync.")
        params: dict[str, object] = {
            "postedAfter": posted_after,
            "marketplaceId": self.account.marketplace_id,
            "pageSize": 500,
        }
        if posted_before:
            params["postedBefore"] = posted_before
        if transaction_status:
            params["transactionStatus"] = transaction_status
        if next_token:
            params["nextToken"] = next_token
        return self._get_json(
            FINANCES_TRANSACTIONS_PATH,
            params=params,
            permission_message=(
                "The Amazon application is missing the Finance and Accounting "
                "permission required for financial transactions."
            ),
        )

    def list_financial_event_groups(
        self,
        *,
        started_after: str,
        started_before: str,
        next_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {
            "MaxResultsPerPage": 100,
            "FinancialEventGroupStartedAfter": started_after,
            "FinancialEventGroupStartedBefore": started_before,
        }
        if next_token:
            params["NextToken"] = next_token
        return self._get_json(
            FINANCES_EVENT_GROUPS_PATH,
            params=params,
            permission_message=(
                "The Amazon application is missing the Finance and Accounting "
                "permission required to retrieve the current balance."
            ),
        )

    @staticmethod
    def _inbound_permission_message() -> str:
        return (
            "The Amazon application is missing the Amazon Fulfillment "
            "permission required for FBA inbound shipments."
        )

    def list_inbound_plans(
        self,
        *,
        pagination_token: str | None = None,
        status: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {
            "pageSize": 30,
            "sortBy": "LAST_UPDATED_TIME",
            "sortOrder": "DESC",
        }
        if pagination_token:
            params["paginationToken"] = pagination_token
        if status:
            params["status"] = status
        return self._get_json(
            f"{FBA_INBOUND_PATH}/inboundPlans",
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def create_inbound_plan(
        self,
        *,
        name: str,
        source_address: dict,
        items: list[dict],
    ) -> SpApiJsonResult:
        return self._post_json(
            f"{FBA_INBOUND_PATH}/inboundPlans",
            json_body={
                "name": name,
                "sourceAddress": source_address,
                "destinationMarketplaces": [self.account.marketplace_id],
                "items": items,
            },
            permission_message=self._inbound_permission_message(),
        )

    def get_inbound_plan(self, inbound_plan_id: str) -> SpApiJsonResult:
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}"
            ),
            permission_message=self._inbound_permission_message(),
        )

    def list_inbound_plan_items(
        self,
        inbound_plan_id: str,
        *,
        pagination_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {"pageSize": 1000}
        if pagination_token:
            params["paginationToken"] = pagination_token
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/items"
            ),
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def list_inbound_plan_boxes(
        self,
        inbound_plan_id: str,
        *,
        pagination_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {"pageSize": 1000}
        if pagination_token:
            params["paginationToken"] = pagination_token
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/boxes"
            ),
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def list_placement_options(
        self,
        inbound_plan_id: str,
        *,
        pagination_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {"pageSize": 20}
        if pagination_token:
            params["paginationToken"] = pagination_token
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/placementOptions"
            ),
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def confirm_placement_option(
        self,
        inbound_plan_id: str,
        placement_option_id: str,
    ) -> SpApiJsonResult:
        return self._post_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/placementOptions/"
                f"{quote(placement_option_id, safe='')}/confirmation"
            ),
            permission_message=self._inbound_permission_message(),
        )

    def get_inbound_shipment(
        self,
        inbound_plan_id: str,
        shipment_id: str,
    ) -> SpApiJsonResult:
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/shipments/"
                f"{quote(shipment_id, safe='')}"
            ),
            permission_message=self._inbound_permission_message(),
        )

    def list_inbound_shipment_items(
        self,
        inbound_plan_id: str,
        shipment_id: str,
        *,
        pagination_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {"pageSize": 1000}
        if pagination_token:
            params["paginationToken"] = pagination_token
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/shipments/"
                f"{quote(shipment_id, safe='')}/items"
            ),
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def list_inbound_shipment_boxes(
        self,
        inbound_plan_id: str,
        shipment_id: str,
        *,
        pagination_token: str | None = None,
    ) -> SpApiJsonResult:
        params: dict[str, object] = {"pageSize": 1000}
        if pagination_token:
            params["paginationToken"] = pagination_token
        return self._get_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/shipments/"
                f"{quote(shipment_id, safe='')}/boxes"
            ),
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def get_legacy_inbound_shipment_items(
        self,
        shipment_confirmation_id: str,
        *,
        next_token: str | None = None,
    ) -> SpApiJsonResult:
        params = {"NextToken": next_token} if next_token else None
        return self._get_json(
            (
                f"{FBA_INBOUND_LEGACY_PATH}/shipments/"
                f"{quote(shipment_confirmation_id, safe='')}/items"
            ),
            params=params,
            permission_message=self._inbound_permission_message(),
        )

    def update_inbound_shipment_tracking(
        self,
        inbound_plan_id: str,
        shipment_id: str,
        *,
        tracking_details: dict,
    ) -> SpApiJsonResult:
        return self._put_json(
            (
                f"{FBA_INBOUND_PATH}/inboundPlans/"
                f"{quote(inbound_plan_id, safe='')}/shipments/"
                f"{quote(shipment_id, safe='')}/trackingDetails"
            ),
            json_body={"trackingDetails": tracking_details},
            permission_message=self._inbound_permission_message(),
        )

    def create_marketplace_item_labels(
        self,
        *,
        msku_quantities: list[dict],
        label_type: str = "STANDARD_FORMAT",
        page_type: str = "A4_21",
    ) -> SpApiJsonResult:
        return self._post_json(
            f"{FBA_INBOUND_PATH}/items/labels",
            json_body={
                "marketplaceId": self.account.marketplace_id,
                "labelType": label_type,
                "pageType": page_type,
                "mskuQuantities": msku_quantities,
            },
            permission_message=self._inbound_permission_message(),
        )

    def get_inbound_box_labels(
        self,
        shipment_confirmation_id: str,
        *,
        page_type: str = "PackageLabel_Letter_2",
        page_size: int = 100,
    ) -> SpApiJsonResult:
        return self._get_json(
            (
                f"{FBA_INBOUND_LEGACY_PATH}/shipments/"
                f"{quote(shipment_confirmation_id, safe='')}/labels"
            ),
            params={
                "PageType": page_type,
                "PageSize": min(1000, max(1, page_size)),
                "PageStartIndex": 0,
            },
            permission_message=self._inbound_permission_message(),
        )

    def test_connection(self) -> ConnectionTestResult:
        response = self._get(
            SELLERS_MARKETPLACE_PARTICIPATIONS_PATH,
            permission_message=(
                "The Amazon application is missing permission for the Sellers API."
            ),
        )
        request_id = response.headers.get("x-amzn-requestid")
        duration_ms = int(getattr(response, "amazon_duration_ms", 0))
        try:
            body = response.json()
            payload = body.get("payload")
            if not isinstance(payload, list):
                raise ValueError
        except (ValueError, AttributeError) as exc:
            raise AmazonTemporaryError(
                "Amazon Sellers API returned an invalid response.",
                error_code="sellers_invalid_response",
                http_status=response.status_code,
                amazon_request_id=request_id,
                duration_ms=duration_ms,
            ) from exc

        marketplace_ids = tuple(
            str(item.get("marketplace", {}).get("id"))
            for item in payload
            if isinstance(item, dict)
            and item.get("marketplace", {}).get("id")
        )
        if self.account.marketplace_id not in marketplace_ids:
            raise AmazonIntegrationError(
                "The connected Amazon account does not participate in the configured marketplace.",
                error_code="marketplace_not_authorized",
                http_status=response.status_code,
                amazon_request_id=request_id,
                duration_ms=duration_ms,
            )
        return ConnectionTestResult(
            marketplace_ids=marketplace_ids,
            amazon_request_id=request_id,
            http_status=response.status_code,
            duration_ms=duration_ms,
        )
