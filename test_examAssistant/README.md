# Helper (v4)

Lightweight Win32 desktop helper for quick LLM queries from selected text or a screenshot region.

## Build

```powershell
.\build.ps1
```

Build profiles:

- Portable (default, static CRT):
	- `./build.ps1 -Profile portable`
- Portable Compact (static CRT, smaller exe):
	- `./build.ps1 -Profile portable_compact`
	- Uses `/DYNAMICBASE:NO` to reduce size (disables ASLR hardening).
- Small (dynamic CRT dependency):
	- `./build.ps1 -Profile small`
- Smallest (dynamic CRT dependency, reduced hardening):
	- `./build.ps1 -Profile smallest`

## Run

```powershell
.\llm_overlay.exe
```

## What Changed In v4

- Basic settings now persist only the live runtime fields used by the app:
	- API `Endpoint`, `API Key`, `Model`, and main `Prompt`
	- `Quick Prompt` for the Ask box
	- Hotkeys and UI settings
- Advanced settings now persist only the Advanced runtime data used by the app:
	- RAG enable state and source path
	- Model Router entries
- Legacy prompt keys are kept only for backward-compatible loading:
	- `prompt_1` is mapped to `prompt`
	- `prompt_2` to `prompt_5` and `user_template` are ignored on save and cleared from new ini files
- Legacy `[Routes]` and `[Ensemble]` data are not written by `Save` anymore.
- Model Router entries are compacted automatically:
	- Empty routes are removed on save or when leaving Advanced.
	- Remaining routes are shifted forward so `route_1`, `route_2`, ... stay continuous.
- Quick Prompt is kept in runtime memory while editing, so switching tabs does not reset it.
- The old multi-LLM merge storage is no longer part of the saved config.

## Provider Support

- OpenAI-compatible APIs
- OpenRouter
- Google Gemini REST API

Provider detection:

- API keys starting with `AIza` use Gemini request format.
- Other keys (for example `sk-...`, `sk-or-...`) use OpenAI-compatible format.

Endpoint shortcuts in settings:

- `openai` -> `https://api.openai.com/v1/chat/completions`
- `openrouter` -> `https://openrouter.ai/api/v1/chat/completions`
- `google` -> `https://generativelanguage.googleapis.com`

## Default Hotkeys (Reset Defaults)

- `Ctrl+Q` Send Prompt
- `Ctrl+Alt+1` Select Area
- `Ctrl+Alt+2` Ask Image
- `Ctrl+R` Cancel Request
- `Alt+V` Toggle Visible
- `Ctrl+Alt+Right` Opacity +
- `Ctrl+Alt+Left` Opacity -
- `Ctrl+Alt+Up` Scroll Up
- `Ctrl+Alt+Down` Scroll Down
- `Ctrl+Alt+S` Toggle Settings
- `Ctrl+Alt+X` Exit App

## Save Behavior

- No `Save`: runtime only, not persisted to disk.
- Press `Save` from Basic: writes the Basic runtime fields plus `Quick Prompt`, hotkeys, and UI settings.
- Press `Save` from Advanced: also writes RAG and Model Router, then compacts blank routes.
- Legacy `[Routes]` and `[Ensemble]` sections are cleared from the saved ini.

## Config Notes

- `config.ini` now uses a minimal layout centered on `[API]`, `[Prompt]`, `[UI]`, `[Hotkeys]`, `[RAG]`, `[ModelRouter]`.
- `Quick Prompt` is stored as `quick_prompt` under `[Prompt]`.
- `config.ini` should remain local/private and is ignored by git.

## Reference Data (RAG-like)

- Reference Data in Advanced settings accepts only `.txt` and `.md` sources.
- PDF/PPT files must be converted to `.txt` or `.md` first, then used as source path.
- You can select a single `.txt/.md` file or a folder that contains `.txt/.md` files.

## Known Limitation (Security)

- API keys in `config.ini` are currently not encrypted.
- If someone gets your local `config.ini`, they can read those keys.
- Planned future option: Windows DPAPI-based local encryption.

## Notes

- Overlay is click-through and non-activating.
- Image requests are sent as PNG captures.
- Reference Data support remains available in Advanced (`.txt` / `.md` only).
- The old `[Ensemble]` save format is deprecated; it is only loaded for backward compatibility.
