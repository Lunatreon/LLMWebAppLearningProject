from fastapi import APIRouter, Depends

from app.api.dependencies import rate_limit_api
from app.api.routes import admin, auth, billing, health, journal, llm, users

api_router = APIRouter(dependencies=[Depends(rate_limit_api)])
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(llm.router, prefix="/llm", tags=["llm"])
api_router.include_router(journal.router, prefix="/journal", tags=["journal"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
