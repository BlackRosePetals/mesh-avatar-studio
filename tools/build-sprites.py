# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10.4", "numpy", "opencv-python-headless"]
# ///
"""Validate local full-size drawings and cut engine-compatible feathered sprites."""

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from agent_common import (
    ALL_EYE_VARIANTS,
    ALL_MOUTH_VARIANTS,
    edit_masks,
    inside_repo,
    project_image,
    read_rig,
)
from PIL import Image


def load_mask(path, size):
    with Image.open(path) as image:
        if image.size != size:
            raise ValueError(f"{path.name}: mask size must match source.png")
        alpha = np.array(image.convert("RGBA"))[..., 3]
    if np.any((alpha != 0) & (alpha != 255)):
        raise ValueError(
            f"{path.name}: use a binary alpha edit mask (0 editable, 255 protected)"
        )
    return (alpha == 0).astype(np.uint8)


def regions(project, rig, size, name):
    mask_path = project / "variant-requests" / name / "mask.png"
    legacy = (
        project
        / "variant-masks"
        / ("eyes_edit_mask.png" if name in ALL_EYE_VARIANTS else "mouth_edit_mask.png")
    )
    if mask_path.exists() or legacy.exists():
        region = load_mask(mask_path if mask_path.exists() else legacy, size)
        if name in ALL_EYE_VARIANTS:
            count, labels = cv2.connectedComponents(region)
            if count != 3:
                raise ValueError(
                    f"{name}: expected two separate eye mask regions, got {count - 1}"
                )
            components = sorted(
                range(1, count), key=lambda i: np.where(labels == i)[1].mean()
            )
            return [(labels == i).astype(np.uint8) for i in components]
        return [region]
    eyes, mouth = edit_masks(rig, size)
    return eyes if name in ALL_EYE_VARIANTS else [mouth]


def visible(image):
    value = image.astype(np.float32)
    value[..., :3] *= value[..., 3, None] / 255
    return value


# Image generators often return the whole picture re-encoded or nudged by a pixel, with the
# transparent background filled in. Sprites only use pixels inside the mask, so such a drawing
# can still be imported from the mask alone, as long as it is the same picture: limits for the
# whole-image shift, the opaque-pixel difference, and the band just outside the mask.
MAX_SHIFT = 3
MAX_OPAQUE_MEAN = 16
RING = 12
MAX_RING_MEAN = 20
MAX_RING_SHARE = 0.12
RING_LEVEL = 48
# Generators also tint the whole picture slightly; on flat skin even a few levels show as a
# patch. The tint is measured just inside the mask edge, where the skin should be unchanged.
TINT_BAND = 10
MAX_TINT = 24
# Pixels compared for those checks. Some illustrations are exported with the skin slightly
# below full alpha (253 in the sample), so "opaque" cannot mean exactly 255.
OPAQUE_ALPHA = 240


def grey(image):
    """Edges of the picture over mid grey, each image with its own alpha."""
    value = visible(image)
    value = value[..., :3].mean(axis=-1) + 128 * (1 - value[..., 3] / 255)
    return cv2.magnitude(cv2.Sobel(value, cv2.CV_32F, 1, 0), cv2.Sobel(value, cv2.CV_32F, 0, 1))


def mask_only(name, variant, source, region):
    """Return the variant aligned to the source, or raise with the reason it differs."""
    opaque = source[..., 3] >= OPAQUE_ALPHA
    (dx, dy), response = cv2.phaseCorrelate(
        grey(source), grey(variant), cv2.createHanningWindow(source.shape[1::-1], cv2.CV_32F)
    )
    if response < 0.05:
        dx = dy = 0.0  # no clear match (e.g. a flat image): judge the differences unshifted
    if max(abs(dx), abs(dy)) > MAX_SHIFT:
        raise ValueError(
            f"{name}: rejected outside-mask changes: the whole image is shifted by "
            f"{dx:+.1f}, {dy:+.1f} px (limit {MAX_SHIFT} px); return it unshifted"
        )
    def difference(image):
        return np.abs(image[..., :3].astype(np.float32) - source[..., :3]).max(axis=-1)

    rest = opaque & (region == 0)
    delta = difference(variant)
    sx, sy = round(dx), round(dy)
    if sx or sy:
        # Keep the correction only when it actually brings the picture closer.
        moved = cv2.warpAffine(
            variant,
            np.float32([[1, 0, -sx], [0, 1, -sy]]),
            source.shape[1::-1],
            flags=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_REPLICATE,
        )
        moved_delta = difference(moved)
        if moved_delta[rest].mean() < delta[rest].mean():
            variant, delta = moved, moved_delta
        else:
            sx = sy = 0
    outside = cv2.distanceTransform((region == 0).astype(np.uint8), cv2.DIST_L2, 5)
    ring = rest & (outside <= RING)
    if not np.any(ring):
        raise ValueError(f"{name}: rejected outside-mask changes: no opaque pixels border the mask")
    opaque_mean = float(delta[rest].mean())
    ring_mean = float(delta[ring].mean())
    ring_share = float((delta[ring] > RING_LEVEL).mean())
    print(
        f"{name}: mask-only check: shift {dx:+.2f}, {dy:+.2f} px, opaque mean {opaque_mean:.2f}/255, "
        f"edge band mean {ring_mean:.2f}/255, {ring_share:.1%} of edge band over {RING_LEVEL}"
    )
    if opaque_mean > MAX_OPAQUE_MEAN:
        raise ValueError(
            f"{name}: rejected outside-mask changes: the picture outside the mask was redrawn "
            f"(opaque mean {opaque_mean:.1f}/255, limit {MAX_OPAQUE_MEAN})"
        )
    if ring_mean > MAX_RING_MEAN or ring_share > MAX_RING_SHARE:
        raise ValueError(
            f"{name}: rejected outside-mask changes: the drawing spills over the mask edge "
            f"(within {RING} px: mean {ring_mean:.1f}/255, {ring_share:.0%} over {RING_LEVEL}; "
            f"limits {MAX_RING_MEAN} and {MAX_RING_SHARE:.0%})"
        )
    # Generators flatten transparency; the masked face keeps the source alpha.
    variant = variant.copy()
    variant[..., 3] = source[..., 3]
    inside = cv2.distanceTransform(region.astype(np.uint8), cv2.DIST_L2, 5)
    band = opaque & (inside > 0) & (inside <= TINT_BAND)
    tint = np.zeros(3)
    if np.any(band):
        tint = np.median(variant[band][:, :3].astype(np.float32) - source[band][:, :3], axis=0)
        if np.abs(tint).max() <= MAX_TINT:
            inner = region > 0
            variant[inner, :3] = np.clip(variant[inner, :3] - tint, 0, 255).astype(np.uint8)
        else:
            tint = np.zeros(3)
    print(
        f"{name}: importing the mask area only (corrected shift {sx:+d}, {sy:+d} px, "
        f"tint {tint[0]:+.0f}, {tint[1]:+.0f}, {tint[2]:+.0f})"
    )
    return variant


def read_variant(name, path, size):
    with Image.open(path) as image:
        if image.format != "PNG":
            raise ValueError(f"{name}: expected PNG size {size[0]} x {size[1]}, got {image.format}")
        resized = image.size != size
        if resized:
            # A uniformly scaled result is the same picture; a different aspect ratio is not.
            if abs(image.width * size[1] / (image.height * size[0]) - 1) > 0.005:
                raise ValueError(
                    f"{name}: expected PNG size {size[0]} x {size[1]}, got {image.size} "
                    "(different aspect ratio)"
                )
            print(f"{name}: resizing {image.width} x {image.height} to {size[0]} x {size[1]}")
            image = image.convert("RGBA").resize(size, Image.Resampling.LANCZOS)
        return np.array(image.convert("RGBA")), resized


def build(project, output=None, tolerance=8):
    project = inside_repo(project)
    if not np.isfinite(tolerance) or not 0 <= tolerance <= 255:
        raise ValueError("tolerance must be between 0 and 255")
    source_image, rig = project_image(project), read_rig(project)
    source = np.array(source_image)
    if rig["image"] != {"width": source_image.width, "height": source_image.height}:
        raise ValueError("rig.image must match source.png")
    images, meta = {}, {}
    for name in (*ALL_EYE_VARIANTS, *ALL_MOUTH_VARIANTS):
        path = project / "variants" / f"{name}.png"
        if not path.exists():
            print(f"Skipping missing variant: {name}")
            continue
        variant, resized = read_variant(name, path, source_image.size)
        parts = regions(project, rig, source_image.size, name)
        region = np.maximum.reduce(parts)
        if not np.any(region) or np.all(region):
            raise ValueError(
                f"{name}: edit mask must contain a nonempty, bounded region"
            )
        delta = np.abs(visible(variant) - visible(source)).max(axis=-1)[region == 0]
        maximum, mean = float(delta.max(initial=0)), float(delta.mean())
        changed = int(np.count_nonzero(delta > tolerance))
        print(
            f"{name}: outside-mask max {maximum:.3f}/255, mean {mean:.6f}/255, {changed} pixels over tolerance {tolerance:g}"
        )
        if changed or resized:
            variant = mask_only(name, variant, source, region)
        for i, part in enumerate(parts):
            weight = np.clip(cv2.distanceTransform(part, cv2.DIST_L2, 5) / 4, 0, 1)
            ys, xs = np.where(weight > 0)
            if not len(xs):
                raise ValueError(f"{name}: empty sprite mask")
            x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
            crop = variant[y0:y1, x0:x1].copy()
            crop[..., 3] = (crop[..., 3] * weight[y0:y1, x0:x1]).astype(np.uint8)
            layer = f"{name}_{i}" if name in ALL_EYE_VARIANTS else name
            images[layer] = crop
            meta[layer] = [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]
    if not images:
        print("No variants available; existing sprites were left unchanged.")
        return
    output = inside_repo(output or project / "built/sprites")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".build-sprites-", dir=output.parent
    ) as temporary:
        stage = Path(temporary)
        for name, crop in images.items():
            Image.fromarray(crop).save(stage / f"{name}.png")
        build_id = hashlib.sha1(
            b"".join((stage / f"{name}.png").read_bytes() for name in sorted(meta))
        ).hexdigest()[:10]
        (stage / "sprites.json").write_text(
            json.dumps({"build": build_id, "layers": meta, "version": 1}, indent=2) + "\n",
            encoding="utf-8",
        )
        output.mkdir(exist_ok=True)
        for filename in [*(f"{name}.png" for name in meta), "sprites.json"]:
            (stage / filename).replace(output / filename)
    print(f"Built {len(meta)} sprites; build {build_id}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument(
        "--out",
        type=Path,
        help="Alternate output inside the repository (for reference comparisons)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=8,
        help="Maximum outside-mask premultiplied RGBA channel difference, 0..255 (default: 8)",
    )
    args = parser.parse_args()
    try:
        build(args.project, args.out, args.tolerance)
    except (OSError, ValueError, KeyError, TypeError, cv2.error) as error:
        print(f"build-sprites: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
