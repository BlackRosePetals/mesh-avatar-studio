"""Local image-tool helpers. Coordinates always refer to source-image pixels."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent


def inside_repo(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("output must stay inside the repository")
    return path


def project_image(project):
    project = inside_repo(project)
    with Image.open(project / "source.png") as image:
        if image.format != "PNG":
            raise ValueError("source.png must be a PNG")
        return image.convert("RGBA")


def read_rig(project, filename=None):
    project = inside_repo(project)
    path = project / (
        filename
        or ("rig.json" if (project / "rig.json").exists() else "rig.draft.json")
    )
    return json.loads(path.read_text(encoding="utf-8"))


def save_image(image, path):
    path = inside_repo(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def save_json(value, path):
    path = inside_repo(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )


def font(size=16):
    return ImageFont.load_default(size=size)


def region_arg(text):
    try:
        values = [int(n) for n in text.split(",")]
    except ValueError as error:
        raise ValueError(
            "region must be x0,y0,x1,y1 in integer source pixels"
        ) from error
    if len(values) != 4 or values[0] >= values[2] or values[1] >= values[3]:
        raise ValueError("region must have positive area: x0,y0,x1,y1")
    return values


def grid_image(image, region=None, step=50):
    if step <= 0:
        raise ValueError("grid step must be positive")
    w, h = image.size
    x0, y0, x1, y1 = region or (0, 0, w, h)
    if not 0 <= x0 < x1 <= w or not 0 <= y0 < y1 <= h:
        raise ValueError("region must be inside the source image")
    grey = Image.new("RGBA", image.size, (145, 145, 145, 255))
    grey.alpha_composite(image)
    crop = grey.convert("RGB").crop((x0, y0, x1, y1))
    width = min(1200, max(900, crop.width))
    scale = width / crop.width
    crop = crop.resize((width, round(crop.height * scale)), Image.Resampling.NEAREST)
    left, top = 64, 38
    result = Image.new("RGB", (crop.width + left, crop.height + top), "#eeeef2")
    result.paste(crop, (left, top))
    draw = ImageDraw.Draw(result)
    label_font = font(14)
    spacing = step * scale
    x_stride = max(1, math.ceil(48 / spacing))
    y_stride = max(1, math.ceil(18 / spacing))
    for x in range(math.ceil(x0 / step) * step, x1, step):
        px = left + round((x - x0) * scale)
        major = (x // step) % 5 == 0
        draw.line(
            (px, top, px, result.height),
            fill="#494f5c" if major else "#737987",
            width=2 if major else 1,
        )
        if (x // step) % x_stride == 0:
            draw.text((px + 2, 15), str(x), font=label_font, fill="#171b23")
    for y in range(math.ceil(y0 / step) * step, y1, step):
        py = top + round((y - y0) * scale)
        major = (y // step) % 5 == 0
        draw.line(
            (left, py, result.width, py),
            fill="#494f5c" if major else "#737987",
            width=2 if major else 1,
        )
        if (y // step) % y_stride == 0:
            draw.text((3, py - 6), str(y), font=label_font, fill="#171b23")
    draw.text((3, 3), "source px", font=font(12), fill="#171b23")
    return result, lambda p: (left + (p[0] - x0) * scale, top + (p[1] - y0) * scale)


EYE_VARIANTS = ("eyes_closed", "eyes_half", "eyes_smile")
# Open eyes drawn for an expression; the brows stay outside the mask (the runtime moves them).
# The angry face keeps the half-closed eyes and only gets a drawn mouth.
EXPRESSION_EYE_VARIANTS = ("eyes_sad", "eyes_surprise")
ALL_EYE_VARIANTS = (*EYE_VARIANTS, *EXPRESSION_EYE_VARIANTS)
MOUTH_VARIANTS = ("mouth_a", "mouth_a_half", "mouth_i", "mouth_o")
# Closed mouths drawn for an expression, shown while the avatar is not speaking.
EXPRESSION_MOUTH_VARIANTS = ("mouth_angry", "mouth_sad")
ALL_MOUTH_VARIANTS = (*MOUTH_VARIANTS, *EXPRESSION_MOUTH_VARIANTS)


def edit_masks(rig, size):
    """RGBA edit-mask convention: transparent pixels may change; opaque pixels stay."""
    import cv2
    import numpy as np

    w, h = size
    if len(rig.get("eyes", [])) != 2:
        raise ValueError("rig.eyes must contain two eyes")
    eye_regions = []
    for i, eye in enumerate(rig["eyes"]):
        points = np.asarray(eye["roi"], dtype=np.float32)
        if (
            points.ndim != 2
            or points.shape[1] != 2
            or len(points) < 3
            or not np.isfinite(points).all()
            or cv2.contourArea(points) <= 0
        ):
            raise ValueError(
                f"rig.eyes[{i}].roi: expected a finite polygon with positive area"
            )
        mask = np.zeros((h, w), np.uint8)
        cv2.fillPoly(mask, [np.rint(points).astype(np.int32)], 1)
        eye_regions.append(cv2.dilate(mask, np.ones((9, 9), np.uint8)))
    if np.any(eye_regions[0] & eye_regions[1]):
        raise ValueError(
            "dilated eye ROIs overlap; separate them before requesting variants"
        )
    mouth = np.zeros((h, w), np.uint8)
    area = rig["mouth"]["area"]
    if (
        not all(np.isfinite(area[k]) for k in ("cx", "cy", "rx", "ry"))
        or min(area["rx"], area["ry"]) <= 0
        or not np.isfinite(area.get("angle", 0))
    ):
        raise ValueError(
            "rig.mouth.area: expected a finite ellipse with positive radii"
        )
    cv2.ellipse(
        mouth,
        (round(area["cx"]), round(area["cy"])),
        (round(area["rx"]), round(area["ry"])),
        math.degrees(area.get("angle", 0)),
        0,
        360,
        1,
        -1,
    )
    mouth = cv2.dilate(mouth, np.ones((9, 9), np.uint8))
    return eye_regions, mouth


def rgba_mask(region):
    import numpy as np

    result = np.zeros((*region.shape, 4), np.uint8)
    result[..., :3] = 255
    result[..., 3] = np.where(region, 0, 255)
    return Image.fromarray(result)
