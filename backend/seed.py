import os
import sys

# Ensure backend root is in Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import asyncio
from app.seed import seed_database

if __name__ == "__main__":
    asyncio.run(seed_database())
