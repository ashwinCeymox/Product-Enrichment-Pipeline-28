import asyncio
import json
import logging
from litellm import completion
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

def run_steel_agent(target_url: str, schema_str: str, project_id: str, openrouter_key: str):
    """
    Run an agent loop with Deepseek that uses Steel MCP tools locally.
    """
    system_prompt = (
        "ROLE: You are an advanced, interactive web scraping agent equipped with a headless browser via Steel MCP tools.\n"
        "GOAL: Extract product data matching the requested JSON schema and output it using the `finish_extraction` tool.\n\n"
        "WORKFLOW:\n"
        "1. Start by using `steel_scrape` (format: 'markdown') to read the target URL.\n"
        "2. Analyze the extracted markdown for critical fields (Price, SKU, Name).\n"
        "3. If crucial data is hidden behind tabs or dynamic elements, use `steel_find` to locate and `steel_act` to click/hover.\n"
        "4. Use `steel_wait_for` if the page needs to dynamically load data.\n"
        "5. Call `steel_scrape` again to read newly revealed data.\n\n"
        "STOP CONDITION:\n"
        "Only call `finish_extraction` ONCE you have hunted down as much data as possible OR if you have tried multiple actions and no new data is found. DO NOT loop endlessly.\n\n"
        "FORBIDDEN:\n"
        "- Do not guess or hallucinate missing prices or SKUs.\n"
        "- Do not give up immediately if the first scrape lacks data."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Target URL: {target_url}\n\nPlease navigate to this URL, hunt down the data, and use `finish_extraction` to return the product information precisely matching this schema:\n{schema_str}"}
    ]
    
    async def _run():
        try:
            params = StdioServerParameters(
                command="node",
                args=["/opt/steel-mcp-server/dist/stdio.js"],
                env={
                    "STEEL_LOCAL": "true",
                    "STEEL_BASE_URL": "http://steel-api:3000",
                    "GLOBAL_WAIT_SECONDS": "1",
                    "PATH": "/usr/local/bin:/usr/bin:/bin"
                }
            )
            
            import sys
            async with stdio_client(params, errlog=sys.__stderr__) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    
                    mcp_tools_resp = await session.list_tools()
                    
                    tools_for_llm = []
                    for t in mcp_tools_resp.tools:
                        tools_for_llm.append({
                            "type": "function",
                            "function": {
                                "name": t.name,
                                "description": t.description,
                                "parameters": getattr(t, "inputSchema", getattr(t, "input_schema", {}))
                            }
                        })
                        
                    tools_for_llm.append({
                        "type": "function",
                        "function": {
                            "name": "finish_extraction",
                            "description": "Call this tool with the final extracted JSON data that matches the requested schema.",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "extracted_json": {
                                        "type": "string",
                                        "description": "The extracted data as a valid JSON string"
                                    }
                                },
                                "required": ["extracted_json"]
                            }
                        }
                    })
                    
                    for _ in range(15):
                        from app.config_loader import get_dynamic_env
                        resp = completion(
                            model=f"openrouter/{get_dynamic_env('SCRAPING_MODEL', 'deepseek/deepseek-chat')}", 
                            messages=messages, 
                            tools=tools_for_llm, 
                            api_key=openrouter_key,
                            temperature=0.2
                        )
                        msg = resp.choices[0].message
                        messages.append(msg.model_dump())
                        
                        if getattr(msg, "tool_calls", None):
                            for tc in msg.tool_calls:
                                func_name = tc.function.name
                                args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                                
                                if func_name == "finish_extraction":
                                    logger.info(f"Agent finished extraction: {args.get('extracted_json')}")
                                    return args.get("extracted_json")
                                
                                try:
                                    logger.info(f"Agent calling MCP tool: {func_name} with {args}")
                                    res = await session.call_tool(func_name, arguments=args)
                                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": str(res.content)})
                                except Exception as tool_e:
                                    logger.error(f"Tool {func_name} failed: {tool_e}")
                                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": f"Error: {tool_e}"})
                        else:
                            return msg.content
                            
                    return "Error: Agent loop exceeded maximum turns."
        except Exception as e:
            return f"Agent Error: {e}"

    return asyncio.run(_run())
