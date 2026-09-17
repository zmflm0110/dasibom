"""Local OCR via macOS's built-in Vision framework (no network, no extra
binaries to install -- unlike tesseract). Used to make screenshots ("아이디어
스크린샷") searchable the same way text clips are: we OCR the image once on
upload and store the recognized text as the clip's `content`.
"""
from pathlib import Path

import Vision
from Foundation import NSURL


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
    return "\n".join(out.get("lines", []))
