from .client import HubSpotClient


def listar_properties(client: HubSpotClient, object_type: str = "tickets") -> None:
    """Lista os internal names das properties (help --listar-properties)."""
    data = client.get(f"/crm/v3/properties/{object_type}")
    props = data.get("results", [])
    print(f"\n{'INTERNAL NAME':40} | LABEL (nome visível na tela)")
    print("-" * 80)
    for p in sorted(props, key=lambda x: x.get("label", "")):
        print(f"{p['name']:40} | {p.get('label', '')}")
