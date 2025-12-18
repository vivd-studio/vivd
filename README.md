# Vivd

domain: hopefully vivd.studio or vivd.io

OpenCode structure:

in container:
/app/ - our app container
/root/.local/share/opencode/ - opencode auth
/root/.local/state/opencode/ - opencode state

- for example: {"recent":[{"providerID":"google","modelID":"gemini-3-pro-preview"}],"favorite":[]} - we could set this?

/root/.local/share/opencode/

- we have: auth.json, log, bin, storage

/root/.local/share/opencode/log/ - opencode log

- for example: 2025-12-11T091850.log 2025-12-11T092556.log

/root/.local/share/opencode/storage

- we have: message migration part project session session_diff

/root/.local/share/opencode/storage/session/global

- for example: ses_4f34327b2ffeFLV1bvmdon3l53.json ses_4f34a4fbdffel8SBYjLW8zrVZ3.json

/root/.config/opencode
