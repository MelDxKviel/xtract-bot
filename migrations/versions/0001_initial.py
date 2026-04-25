"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-25 00:00:00
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("username", sa.Text(), nullable=True),
        sa.Column("first_name", sa.Text(), nullable=True),
        sa.Column("last_name", sa.Text(), nullable=True),
        sa.Column("is_allowed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_users_telegram_id", "users", ["telegram_id"])

    op.create_table(
        "tweet_cache",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tweet_id", sa.Text(), nullable=False, unique=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "share_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=True),
        sa.Column("tweet_id", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_share_events_telegram_user_id", "share_events", ["telegram_user_id"])
    op.create_index("ix_share_events_tweet_id", "share_events", ["tweet_id"])
    op.create_index("ix_share_events_created_at", "share_events", ["created_at"])

    op.create_table(
        "admin_actions",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("admin_telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_telegram_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_admin_actions_admin_telegram_id", "admin_actions", ["admin_telegram_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_actions_admin_telegram_id", table_name="admin_actions")
    op.drop_table("admin_actions")
    op.drop_index("ix_share_events_created_at", table_name="share_events")
    op.drop_index("ix_share_events_tweet_id", table_name="share_events")
    op.drop_index("ix_share_events_telegram_user_id", table_name="share_events")
    op.drop_table("share_events")
    op.drop_table("tweet_cache")
    op.drop_index("ix_users_telegram_id", table_name="users")
    op.drop_table("users")
