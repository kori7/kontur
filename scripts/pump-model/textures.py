"""Generate original, tileable PBR surface maps with a fixed random seed."""

from pathlib import Path
import random
from PIL import Image, ImageFilter


SIZE = 512
TARGET = Path(__file__).resolve().parent / "textures"
TARGET.mkdir(exist_ok=True)


def texture(profile: str, seed: int) -> None:
    rng = random.Random(seed)
    grain = Image.new("L", (SIZE, SIZE))
    grain.putdata([max(0, min(255, round(rng.gauss(128, 25)))) for _ in range(SIZE * SIZE)])
    if profile == "brushed":
        grain = grain.resize((48, SIZE)).resize((SIZE, SIZE), Image.Resampling.BILINEAR)
    elif profile == "base":
        grain = grain.filter(ImageFilter.GaussianBlur(0.65))
    pixels = list(grain.tobytes())
    strength = {"cast": 1.0, "brushed": 0.22, "base": 0.5}[profile]
    color = Image.new("RGB", (SIZE, SIZE))
    color.putdata([(round(222 + (v - 128) * 0.22),) * 3 for v in pixels])
    roughness = Image.new("RGB", (SIZE, SIZE))
    roughness.putdata([(max(0, min(255, round(188 + (v - 128) * 0.55))),) * 3 for v in pixels])
    normals = []
    for y in range(SIZE):
        for x in range(SIZE):
            dx = (pixels[y * SIZE + (x + 1) % SIZE] - pixels[y * SIZE + (x - 1) % SIZE]) / 255 * strength
            dy = (pixels[((y + 1) % SIZE) * SIZE + x] - pixels[((y - 1) % SIZE) * SIZE + x]) / 255 * strength
            length = (dx * dx + dy * dy + 1) ** 0.5
            normals.append((round(127.5 - dx / length * 127.5), round(127.5 - dy / length * 127.5), round(127.5 + 127.5 / length)))
    normal = Image.new("RGB", (SIZE, SIZE))
    normal.putdata(normals)
    for suffix, image in [("color", color), ("roughness", roughness), ("normal", normal)]:
        image.save(TARGET / f"{profile}-{suffix}.png", optimize=True)


for index, profile in enumerate(["cast", "brushed", "base"]):
    texture(profile, 1401 + index)
print("PBR textures: 9 deterministic color, roughness and normal maps generated")
