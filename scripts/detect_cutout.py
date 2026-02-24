from PIL import Image
import numpy as np
from collections import deque
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "src/assets/devices/keba-Kiosk.png"
img = Image.open(path).convert("RGBA")
w, h = img.size
print(f"Dimensions: {w}x{h}")

data = np.array(img)
alpha = data[:, :, 3]
threshold = 16
transparent = alpha < threshold

visited = np.zeros((h, w), dtype=np.uint8)
queue = deque()

for x in range(w):
    if transparent[0, x] and visited[0, x] == 0:
        visited[0, x] = 1
        queue.append((x, 0))
    if transparent[h - 1, x] and visited[h - 1, x] == 0:
        visited[h - 1, x] = 1
        queue.append((x, h - 1))
for y in range(1, h - 1):
    if transparent[y, 0] and visited[y, 0] == 0:
        visited[y, 0] = 1
        queue.append((0, y))
    if transparent[y, w - 1] and visited[y, w - 1] == 0:
        visited[y, w - 1] = 1
        queue.append((w - 1, y))

while queue:
    cx, cy = queue.popleft()
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        nx, ny = cx + dx, cy + dy
        if 0 <= nx < w and 0 <= ny < h and visited[ny, nx] == 0 and transparent[ny, nx]:
            visited[ny, nx] = 1
            queue.append((nx, ny))

interior = transparent & (visited == 0)

labeled = np.zeros((h, w), dtype=np.int32)
label = 0
components = []

for y in range(h):
    for x in range(w):
        if interior[y, x] and labeled[y, x] == 0:
            label += 1
            comp_queue = deque([(x, y)])
            labeled[y, x] = label
            min_x, min_y, max_x, max_y = x, y, x, y
            area = 0
            while comp_queue:
                cx, cy = comp_queue.popleft()
                area += 1
                min_x = min(min_x, cx)
                min_y = min(min_y, cy)
                max_x = max(max_x, cx)
                max_y = max(max_y, cy)
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and interior[ny, nx] and labeled[ny, nx] == 0:
                        labeled[ny, nx] = label
                        comp_queue.append((nx, ny))
            components.append((area, min_x, min_y, max_x - min_x + 1, max_y - min_y + 1))

components.sort(key=lambda c: c[0], reverse=True)
print(f"Found {len(components)} interior holes")
for i, (area, x, y, cw, ch) in enumerate(components[:5]):
    print(f"  Hole {i + 1}: area={area}, x={x}, y={y}, w={cw}, h={ch}")
