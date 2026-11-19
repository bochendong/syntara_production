import * as T from './vendor/three.module.js';

const asset = (name) => new URL('./scholar-original/' + name, import.meta.url);

const partsPromise = fetch(asset('parts.json')).then((r) => r.json());
let textures;
export function originalShinoMaterials() {
  return (textures ??= partsPromise.then((parts) => {
    const loader = new T.TextureLoader();
    return Promise.all(
      parts.map(async ({ id, tint }) => {
        const map = await loader.loadAsync(asset(id + '.webp').href);
        map.flipY = false;
        map.colorSpace = T.SRGBColorSpace;
        const color = new T.Color().setRGB(...tint, T.SRGBColorSpace);
        return new T.MeshBasicMaterial({ map, color, alphaTest: 0.32, side: T.DoubleSide });
      }),
    );
  }));
}

// Display mesh from VRoid Project's Welcome School Uniform 2019 (648876553405728395).
// The original geometry and diffuse maps use a relaxed arm pose for the turntable.
export async function loadOriginalShino() {
  const [parts, bytes] = await Promise.all([
    partsPromise,
    fetch(asset('mesh.bin')).then((r) => r.arrayBuffer()),
  ]);
  const materials = await originalShinoMaterials();
  const meshes = await Promise.all(
    parts.map(async ({ id, offset, count, indices }) => {
      const data = new T.InterleavedBuffer(new Float32Array(bytes, offset, count * 5), 5);
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.InterleavedBufferAttribute(data, 3, 0));
      geometry.setAttribute('uv', new T.InterleavedBufferAttribute(data, 2, 3));
      geometry.setIndex(
        new T.BufferAttribute(new Uint32Array(bytes, offset + count * 20, indices), 1),
      );
      return new T.Mesh(geometry, materials[id]);
    }),
  );
  return new T.Group().add(...meshes);
}
