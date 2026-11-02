from PIL import Image, ImageDraw, ImageFilter
import math

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# diagonal pink -> magenta -> violet gradient
stops = [(0.0, (255, 161, 194)), (0.48, (255, 79, 143)), (1.0, (169, 123, 241))]
def color_at(t):
    for i in range(len(stops) - 1):
        a, ca = stops[i]
        b, cb = stops[i + 1]
        if a <= t <= b:
            u = (t - a) / (b - a)
            return tuple(int(ca[j] + (cb[j] - ca[j]) * u) for j in range(3))
    return stops[-1][1]

grad = Image.new('RGB', (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    for x in range(0, S, 16):
        t = min(1.0, max(0.0, (x * 0.55 + y * 0.45) / (S * 1.12)))
        gd.rectangle([x, y, x + 15, y], fill=color_at(t))

mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([20, 20, S - 20, S - 20], radius=286, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img, 'RGBA')

# soft upper highlight
gloss = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd2 = ImageDraw.Draw(gloss)
gd2.ellipse([110, 55, 900, 560], fill=(255, 255, 255, 55))
gloss = gloss.filter(ImageFilter.GaussianBlur(110))
img = Image.alpha_composite(img, gloss)
d = ImageDraw.Draw(img, 'RGBA')

# cherry petals, translucent white
def petal(cx, cy, rx, ry, angle, alpha=170):
    layer = Image.new('RGBA', (rx * 4, ry * 4), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([rx * 1.2, ry * 1.15, rx * 2.8, ry * 2.85], fill=(255, 255, 255, alpha))
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=False)
    img.alpha_composite(layer, (int(cx - rx * 2), int(cy - ry * 2)))

petal(842, 190, 92, 58, -25, 165)
petal(924, 320, 58, 36, 30, 110)
petal(690, 150, 38, 24, -10, 90)
petal(160, 780, 72, 45, 28, 70)

# Android head
body = [214, 346, 810, 806]
d.rounded_rectangle(body, radius=188, fill=(255, 255, 255, 247))
# subtle body shade
shade = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(shade)
sd.ellipse([240, 540, 780, 880], fill=(255, 159, 194, 38))
shade = shade.filter(ImageFilter.GaussianBlur(36))
img = Image.alpha_composite(img, shade)
d = ImageDraw.Draw(img, 'RGBA')

# antennae
d.line([336, 318, 278, 238], fill=(255, 255, 255, 238), width=26)
d.line([688, 318, 746, 238], fill=(255, 255, 255, 238), width=26)
d.ellipse([254, 214, 302, 262], fill=(255, 255, 255, 238))
d.ellipse([722, 214, 770, 262], fill=(255, 255, 255, 238))
# eyes
d.ellipse([398, 522, 470, 594], fill=(239, 62, 124, 255))
d.ellipse([554, 522, 626, 594], fill=(239, 62, 124, 255))
# tiny inner highlights
d.ellipse([421, 545, 443, 567], fill=(255, 255, 255, 150))
d.ellipse([577, 545, 599, 567], fill=(255, 255, 255, 150))

# bottom glass edge light
edge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ed = ImageDraw.Draw(edge)
ed.arc([20, 20, S - 20, S - 20], 150, 330, fill=(255, 255, 255, 90), width=8)
edge = edge.filter(ImageFilter.GaussianBlur(2))
img = Image.alpha_composite(img, edge)

# downsample for crispness
icon = img.resize((512, 512), Image.LANCZOS)
icon.save('build/icon.png')
icon.save('build/icon-256.png')
icon.save('build/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('icon written', icon.size)
