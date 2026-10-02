export type AgentShell = "unix" | "powershell";

export function agentSetupCommands(origin: string, shell: AgentShell, code?: string) {
  const url = new URL(origin).origin;
  const quote = (value: string) => `'${value.replaceAll("'", shell === "powershell" ? "''" : "'\\''")}'`;
  const file = '"$HOME/.origin-agent/bin/origin-agent.mjs"';
  const run = `node ${file} --origin ${quote(url)}`;
  return {
    download: shell === "powershell"
      ? `New-Item -ItemType Directory -Force "$HOME/.origin-agent/bin" | Out-Null; Invoke-WebRequest -Uri ${quote(`${url}/agent/origin-agent.mjs`)} -OutFile ${file}`
      : `curl --fail --show-error --location --create-dirs --output ${file} ${quote(`${url}/agent/origin-agent.mjs`)}`,
    login: `${run} --login`,
    pair: code ? `${run} --pair ${quote(code)}` : "",
    resume: run,
    check: `${run} --check`,
  };
}
