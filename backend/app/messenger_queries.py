"""Bounded conversation summaries without per-contact database queries."""
from sqlalchemy import case, func, or_
from .models import InternalMessage


def conversation_summaries(db, user_id, tenant_id, contact_ids):
    if not contact_ids:
        return {}, {}, {}
    peer = case((InternalMessage.sender_user_id == user_id, InternalMessage.recipient_user_id), else_=InternalMessage.sender_user_id)
    activity = db.query(peer, func.max(InternalMessage.created_at)).execution_options(skip_tenant_scope=True).filter(
        or_(InternalMessage.sender_user_id == user_id, InternalMessage.recipient_user_id == user_id),
        peer.in_(contact_ids),
    )
    unread = db.query(
        InternalMessage.id.label('message_id'),
        func.row_number().over(partition_by=InternalMessage.sender_user_id, order_by=InternalMessage.id.desc()).label('position'),
        func.count().over(partition_by=InternalMessage.sender_user_id).label('total'),
    ).execution_options(skip_tenant_scope=True).filter(
        InternalMessage.sender_user_id.in_(contact_ids),
        InternalMessage.recipient_user_id == user_id,
        InternalMessage.read_at.is_(None),
    )
    if tenant_id is not None:
        activity = activity.filter(InternalMessage.tenant_id == tenant_id)
        unread = unread.filter(InternalMessage.tenant_id == tenant_id)
    last_by_peer = dict(activity.group_by(peer).all())
    ranked = unread.subquery()
    recent = db.query(InternalMessage, ranked.c.total).execution_options(skip_tenant_scope=True).join(
        ranked, ranked.c.message_id == InternalMessage.id,
    ).filter(ranked.c.position <= 5).order_by(InternalMessage.id.desc()).all()
    counts, previews = {}, {}
    for message, total in recent:
        counts[message.sender_user_id] = int(total)
        previews.setdefault(message.sender_user_id, []).append(message)
    return counts, last_by_peer, previews
