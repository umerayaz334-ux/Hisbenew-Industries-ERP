from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

connected_agents = {}


@router.websocket("/ws/print-agent")
async def print_agent(websocket: WebSocket):

    await websocket.accept()

    agent_name = None

    try:
        while True:

            data = await websocket.receive_json()

            if data.get("type") == "register":

                agent_name = data.get("agent")

                connected_agents[agent_name] = websocket

                print(
                    f"Print Agent Connected: {agent_name}"
                )

                await websocket.send_json({
                    "status": "registered",
                    "agent": agent_name
                })

    except WebSocketDisconnect:

        if agent_name:
            connected_agents.pop(agent_name, None)

        print(
            f"Print Agent Disconnected: {agent_name}"
        )