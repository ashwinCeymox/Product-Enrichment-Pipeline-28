import asyncio
import os
from mcp.client.stdio import stdio_client, StdioServerParameters
from mcp import ClientSession
import sys

async def main():
    print("Starting smoke test...")
    params = StdioServerParameters(
        command="node",
        args=["/opt/steel-mcp-server/dist/stdio.js"],
        env={
            "STEEL_LOCAL": "true",
            "STEEL_BASE_URL": "http://steel-api:3000",
            "GLOBAL_WAIT_SECONDS": "1",
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
        }
    )
    
    print(f"Connecting to MCP server: {params.command} {' '.join(params.args)}")
    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                print("Initialized successfully!")
                
                tools_response = await session.list_tools()
                print("\n--- AVAILABLE TOOLS ---")
                try:
                    for tool in tools_response.tools:
                        print(f"\nTool: {tool.name}")
                        print(f"Description: {tool.description}")
                        print(f"Schema: {getattr(tool, 'inputSchema', getattr(tool, 'input_schema', 'N/A'))}")
                except Exception as loop_e:
                    print(f"Error while printing tools: {loop_e}")
                print("\n-----------------------")
                await asyncio.sleep(2)
    except BaseException as e:
        print(f"Failed to connect or list tools: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
