import json, pathlib

root = pathlib.Path(__file__).parent
tpl = (root / "web" / "template.html").read_text(encoding="utf-8")
parser = (root / "src" / "parser.js").read_text(encoding="utf-8")
cfg = json.loads((root / "examples" / "robot-status.json").read_text(encoding="utf-8"))

codegen = (root / "src" / "codegen.js").read_text(encoding="utf-8")
encoder = (root / "src" / "encoder.js").read_text(encoding="utf-8")
importer = (root / "src" / "importer.js").read_text(encoding="utf-8")
validate = (root / "src" / "validate.js").read_text(encoding="utf-8")
out = tpl.replace("/*__PARSER__*/", parser)
out = out.replace("/*__CODEGEN__*/", codegen)
out = out.replace("/*__ENCODER__*/", encoder)
out = out.replace("/*__IMPORTER__*/", importer)
out = out.replace("/*__VALIDATE__*/", validate)
out = out.replace("/*__CONFIG__*/", "const DEFAULT_CONFIG = " + json.dumps(cfg, ensure_ascii=False, indent=2) + ";")

dist = root / "dist"
dist.mkdir(exist_ok=True)
target = dist / "protocol-tool.html"
target.write_text(out, encoding="utf-8")
print("built", target, len(out), "bytes")
