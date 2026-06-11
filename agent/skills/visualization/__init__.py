from agent.skills.visualization.tools import visualize

SKILL_NAME = "visualization"
SKILL_DESCRIPTION = "Produces Vega-Lite visualization specs for the frontend to render. The agent decides the best chart type based on the data and question context."

TOOLS = [visualize]
