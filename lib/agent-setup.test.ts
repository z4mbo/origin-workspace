import { describe, expect, it } from "vitest";
import { agentSetupCommands } from "./agent-setup";

describe("companion setup commands", () => {
  it("downloads and runs the same home-relative path regardless of the current directory", () => {
    const commands = agentSetupCommands("https://origin.example.com", "unix", "abc123");
    for (const command of Object.values(commands)) expect(command).toContain('"$HOME/.origin-agent/bin/origin-agent.mjs"');
    expect(commands.download).toContain("--fail");
    expect(commands.download).toContain("--create-dirs");
    expect(commands.download).not.toContain("| sh");
    expect(commands.pair).toContain("--pair 'abc123'");
    expect(commands.resume).not.toContain("--pair");
  });
  it("provides native PowerShell download commands without relying on its curl alias", () => {
    const commands = agentSetupCommands("https://origin.example", "powershell");
    expect(commands.download).toContain("New-Item -ItemType Directory -Force");
    expect(commands.download).toContain("Invoke-WebRequest");
    expect(commands.pair).toBe("");
  });
  it("quotes pairing arguments for both supported shells", () => {
    expect(agentSetupCommands("https://origin.example", "unix", "x'y").pair).toContain("'x'\\''y'");
    expect(agentSetupCommands("https://origin.example", "powershell", "x'y").pair).toContain("'x''y'");
  });
});
