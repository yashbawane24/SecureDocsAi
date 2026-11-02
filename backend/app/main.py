from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings, verify_production_secrets
from app.core.database import engine, Base
from app.core.security_headers import SecurityHeadersMiddleware
from app.services.storage import ensure_storage_dir

from app.api.auth import router as auth_router
from app.api.documents import router as documents_router
from app.api.shares import router as shares_router
from app.api.view import router as view_router
from app.api.notifications import router as notifications_router
from app.api.audit import router as audit_router
from app.api.organizations import router as organizations_router
from app.api.roles import router as roles_router
from app.api.departments import router as departments_router
from app.api.members import router as members_router
from app.api.dashboard import router as dashboard_router
from app.api.approvals import router as approvals_router
from app.api.events import router as events_router
from app.api.demo_inbox import router as demo_inbox_router
from app.services.email import verify_email_transport_on_startup
from app.services.mailpit_dev import get_messages

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Enforce production secrets verification
    verify_production_secrets()

    # 2. Ensure encrypted storage directory exists
    ensure_storage_dir()

    # 3. Verify mail transport on startup (Mailpit / SMTP / Resend)
    verify_email_transport_on_startup()

    # 4. Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # Teardown
    await engine.dispose()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="SecureDocs AI — Sensitive Document Control, NLP Risk Analysis & Redaction Platform",
    lifespan=lifespan
)

# Apply Security Headers
app.add_middleware(SecurityHeadersMiddleware)

# Apply CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(auth_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(shares_router, prefix="/api")
app.include_router(view_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(organizations_router, prefix="/api")
app.include_router(roles_router, prefix="/api")
app.include_router(departments_router, prefix="/api")
app.include_router(members_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(approvals_router, prefix="/api")
app.include_router(events_router, prefix="/api")
app.include_router(demo_inbox_router, prefix="/api")

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "SecureDocs AI",
        "version": settings.VERSION,
        "environment": settings.ENV
    }


@app.get("/api/mailpit/messages")
async def mailpit_messages_mirror():
    msgs = get_messages()
    return {"total": len(msgs), "count": len(msgs), "messages": msgs}
