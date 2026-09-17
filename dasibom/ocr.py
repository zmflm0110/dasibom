"""Local OCR via macOS's built-in Vision framework (no network, no extra
binaries to install -- unlike tesseract). Used to make screenshots ("아이디어
스크린샷") searchable the same way text clips are: we OCR the image once on
upload and store the recognized text as the clip's `content`.
"""
import re
from pathlib import Path

import Vision
from Foundation import NSURL

# Vision emits a bare "X" where it can't render a glyph, so an emoji in a KakaoTalk
# screenshot comes back as "김치 보냈다 X". Only strip an isolated X that sits between
# Korean characters -- "3세트 x 12회" and "L X 2" are real text and must survive.
# [ \t] rather than \s: \s swallows the newline and welds two OCR lines together.
_EMOJI_ARTIFACT = re.compile(r"(?<=[가-힣])[ \t]+[Xx][ \t]+(?=[가-힣])")
_TRAILING_ARTIFACT = re.compile(r"(?<=[가-힣])[ \t]+[Xx][ \t]*$", re.MULTILINE)


def extract_text(image_path: Path | str) -> str:
    url = NSURL.fileURLWithPath_(str(image_path))
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, None)

    out: dict = {}

    def _on_complete(request, error):
        observations = request.results() or []
        lines = []
        for obs in observations:
            candidates = obs.topCandidates_(1)
            if candidates:
                lines.append(str(candidates[0].string()))
        out["lines"] = lines

    request = Vision.VNRecognizeTextRequest.alloc().initWithCompletionHandler_(_on_complete)
    request.setRecognitionLanguages_(["ko-KR", "en-US"])
    request.setUsesLanguageCorrection_(True)

    ok, error = handler.performRequests_error_([request], None)
    if not ok:
        return ""
    return clean(out.get("lines", []))


def clean(lines: list[str]) -> str:
    text = "\n".join(lines)
    text = _EMOJI_ARTIFACT.sub(" ", text)
    text = _TRAILING_ARTIFACT.sub("", text)
    return text
