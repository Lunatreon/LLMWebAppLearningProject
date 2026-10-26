from fastapi import APIRouter, Depends

from backend.api.dependencies import rate_limit_api
from backend.api.routes import admin, auth, billing, feedback, health, llm, users
from backend.api.routes import webmail
from backend.api.routes import terms

api_router = APIRouter(dependencies=[Depends(rate_limit_api)])
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(llm.router, prefix="/llm", tags=["llm"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(feedback.router, tags=["feedback"])
api_router.include_router(webmail.router, prefix="/webmail", tags=["webmail"])
api_router.include_router(terms.router, prefix="/terms", tags=["terms"])
