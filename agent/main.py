"""
Financial Planning Agent — Main entry point.

Uses Strands SDK to create an agent with skill-based tools.
Can be run standalone (CLI chat) or imported by the API server.
"""

import os
from pathlib import Path

from strands import Agent
from strands.models.anthropic import AnthropicModel

from agent.prompts import SYSTEM_PROMPT
from agent.profile import create_sample_profile
from agent.skills.cash_flow import TOOLS as CASH_FLOW_TOOLS
from agent.skills.asset_location import TOOLS as ASSET_LOCATION_TOOLS
from agent.skills.visualization import TOOLS as VISUALIZATION_TOOLS


def _ensure_profile_exists() -> None:
    """Create sample profile.json if it doesn't exist yet."""
    profile_path = Path("profile.json")
    if not profile_path.exists():
        profile = create_sample_profile()
        profile.save(str(profile_path))
        print(f"Created sample profile at {profile_path}")


def create_agent() -> Agent:
    """Create and return the financial planning agent with all skill tools."""
    _ensure_profile_exists()

    # Combine tools from all active skills
    all_tools = [
        *CASH_FLOW_TOOLS,
        *ASSET_LOCATION_TOOLS,
        *VISUALIZATION_TOOLS,
    ]

    model = AnthropicModel(
        model_id="claude-sonnet-4-6",
        api_key=os.environ["ANTHROPIC_API_KEY"],
        max_tokens=8096,
    )

    # Cache the system prompt so repeated calls during testing don't re-process it.
    # Cached tokens cost ~10% of normal input price; cache TTL is 5 minutes.
    cached_system_prompt = [
        {
            "text": SYSTEM_PROMPT,
            "type": "text",
            "cache_control": {"type": "ephemeral"},
        }
    ]

    agent = Agent(
        model=model,
        system_prompt=cached_system_prompt,
        tools=all_tools,
    )

    return agent


def run_cli() -> None:
    """Run the agent in interactive CLI mode for development/testing."""
    _ensure_profile_exists()
    agent = create_agent()

    print("=" * 60)
    print("  Financial Planning Agent")
    print("  Type 'quit' or 'exit' to stop")
    print("  Type 'reset' to clear conversation history")
    print("=" * 60)
    print()

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit"):
            print("Goodbye!")
            break
        if user_input.lower() == "reset":
            agent = create_agent()
            print("Conversation reset.\n")
            continue

        try:
            response = agent(user_input)
            print(f"\nAgent: {response}\n")
        except Exception as e:
            print(f"\nError: {e}\n")


if __name__ == "__main__":
    run_cli()
