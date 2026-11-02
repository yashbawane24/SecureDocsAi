import os
import shutil
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import StaticPool

TEST_DB_PATH = os.path.abspath("./test_suite_run.db")
if os.path.exists(TEST_DB_PATH):
    try:
        os.remove(TEST_DB_PATH)
    except Exception:
        pass

os.environ["ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"
os.environ["STORAGE_DIR"] = "./test_vault_storage"

from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app

test_engine = create_async_engine(
    f"sqlite+aiosqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True
)

TestAsyncSessionLocal = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

async def override_get_db():
    async with TestAsyncSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db

from app.core.rate_limiter import rate_limiter

@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_test_db():
    rate_limiter.reset()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    
    os.makedirs(settings.STORAGE_DIR, exist_ok=True)
    yield

@pytest_asyncio.fixture(scope="session", autouse=True)
def cleanup_after_all_tests():
    yield
    # Final cleanup
    if os.path.exists(settings.STORAGE_DIR):
        shutil.rmtree(settings.STORAGE_DIR, ignore_errors=True)
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except Exception:
            pass

@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
