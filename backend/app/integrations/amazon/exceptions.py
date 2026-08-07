"""Safe exception types for Amazon integration failures."""

from .constants import (
    CONNECTION_AUTHORIZATION_EXPIRED,
    CONNECTION_FAILED,
    CONNECTION_PERMISSION_MISSING,
)


class AmazonIntegrationError(Exception):
    def __init__(
        self,
        message: str,
        *,
        error_code: str = "amazon_error",
        http_status: int | None = None,
        amazon_request_id: str | None = None,
        duration_ms: int | None = None,
        connection_status: str = CONNECTION_FAILED,
    ) -> None:
        super().__init__(message)
        self.safe_message = message
        self.error_code = error_code
        self.http_status = http_status
        self.amazon_request_id = amazon_request_id
        self.duration_ms = duration_ms
        self.connection_status = connection_status


class AmazonConfigurationError(AmazonIntegrationError):
    pass


class AmazonAuthorizationError(AmazonIntegrationError):
    def __init__(self, message: str, **kwargs) -> None:
        kwargs.setdefault("connection_status", CONNECTION_AUTHORIZATION_EXPIRED)
        super().__init__(message, **kwargs)


class AmazonPermissionError(AmazonIntegrationError):
    def __init__(self, message: str, **kwargs) -> None:
        kwargs.setdefault("connection_status", CONNECTION_PERMISSION_MISSING)
        super().__init__(message, **kwargs)


class AmazonRateLimitError(AmazonIntegrationError):
    pass


class AmazonTemporaryError(AmazonIntegrationError):
    pass
