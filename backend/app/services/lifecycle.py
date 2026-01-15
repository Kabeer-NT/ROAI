"""
Application Lifecycle Management
================================
Integrates all optimized services with FastAPI lifecycle.

Usage in main.py:
    from app.services.lifecycle import lifespan
    
    app = FastAPI(lifespan=lifespan)
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
import asyncio


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.
    Handles startup and shutdown for all optimized services.
    """
    # ==========================================================================
    # STARTUP
    # ==========================================================================
    print("🚀 Starting up optimized services...")
    
    # Import services here to avoid circular imports
    from app.services import claude_optimized as claude
    from app.services import suggestions_optimized as suggestions
    from app.services import spreadsheet_optimized as spreadsheet
    
    # Pre-warm HTTP clients
    await claude.startup()
    print("   ✓ Claude HTTP client ready")
    
    # Start periodic cleanup task for workbook cache
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    print("   ✓ Cache cleanup task started")
    
    print("✅ All services ready")
    
    yield  # Application runs here
    
    # ==========================================================================
    # SHUTDOWN
    # ==========================================================================
    print("🛑 Shutting down services...")
    
    # Cancel cleanup task
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    print("   ✓ Cleanup task stopped")
    
    # Close HTTP clients
    await claude.shutdown()
    print("   ✓ Claude HTTP client closed")
    
    await suggestions.shutdown()
    print("   ✓ Suggestions HTTP client closed")
    
    # Shutdown thread pool
    spreadsheet.shutdown_executor()
    print("   ✓ Thread pool shut down")
    
    # Clear caches
    spreadsheet.clear_context()
    suggestions.clear_all_caches()
    print("   ✓ Caches cleared")
    
    print("✅ Shutdown complete")


async def _periodic_cleanup():
    """
    Periodically clean up expired workbook caches.
    Runs every 60 seconds.
    """
    from app.services import spreadsheet_optimized as spreadsheet
    
    while True:
        try:
            await asyncio.sleep(60)
            spreadsheet.cleanup_expired_workbooks()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ Cleanup error: {e}")


# =============================================================================
# HEALTH CHECK ENDPOINT DATA
# =============================================================================

def get_health_stats() -> dict:
    """
    Get health statistics for monitoring.
    Can be exposed via a /health endpoint.
    """
    from app.services import spreadsheet_optimized as spreadsheet
    from app.services import suggestions_optimized as suggestions
    
    return {
        "status": "healthy",
        "caches": {
            "spreadsheet": spreadsheet.get_cache_stats(),
            "suggestions": suggestions.get_cache_stats(),
        }
    }