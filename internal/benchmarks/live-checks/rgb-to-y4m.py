# Converts raw RGB24 frames to a short Y4M (I420) clip for Chrome's fake camera. Usage: python3 -I rgb-to-y4m.py in.rgb out.y4m
import sys
W, H, FRAMES = 1280, 720, 30
rgb = open(sys.argv[1], "rb").read()
Y = bytearray(W * H); U = bytearray((W // 2) * (H // 2)); V = bytearray((W // 2) * (H // 2))
for y in range(H):
    row = y * W * 3
    for x in range(W):
        r, g, b = rgb[row + x * 3], rgb[row + x * 3 + 1], rgb[row + x * 3 + 2]
        Y[y * W + x] = max(0, min(255, int(0.257 * r + 0.504 * g + 0.098 * b + 16)))
        if y % 2 == 0 and x % 2 == 0:
            i = (y // 2) * (W // 2) + x // 2
            U[i] = max(0, min(255, int(-0.148 * r - 0.291 * g + 0.439 * b + 128)))
            V[i] = max(0, min(255, int(0.439 * r - 0.368 * g - 0.071 * b + 128)))
with open(sys.argv[2], "wb") as f:
    f.write(f"YUV4MPEG2 W{W} H{H} F15:1 Ip A1:1 C420jpeg\n".encode())
    for _ in range(FRAMES):
        f.write(b"FRAME\n"); f.write(Y); f.write(U); f.write(V)
