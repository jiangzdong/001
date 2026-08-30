import os
import pyximport

build_dir = os.environ.get("DITTO_PYXBUILD")
if build_dir:
    os.makedirs(build_dir, exist_ok=True)
pyximport.install(build_dir=build_dir)

from .blend import blend_images_cy
