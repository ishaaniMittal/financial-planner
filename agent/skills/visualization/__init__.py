from agent.skills.visualization.tools import visualize, save_to_report

SKILL_NAME = "visualization"
SKILL_DESCRIPTION = "Produces Vega-Lite visualization specs for the frontend to render. The agent decides the best chart type based on the data and question context. Can also save visualizations to a persistent report dashboard."

TOOLS = [visualize, save_to_report]
