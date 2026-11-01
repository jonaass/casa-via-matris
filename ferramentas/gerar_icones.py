"""
Gera os ícones do app em icones/ (opcional, roda fora do app).

    pip install pillow
    python3 ferramentas/gerar_icones.py

Desenho: a marca do front do Jonas (casa em contorno com um coração), em dourado
sobre o verde-escuro da barra lateral. O ícone "maskable" deixa margem maior,
porque o Android corta as bordas em círculo.
"""
from pathlib import Path

from PIL import Image, ImageDraw

VERDE = (22, 68, 58)       # #16443a, --lateral do css/styles.css e theme_color do manifest
DOURADO = (243, 199, 124)  # #f3c77c, cor da .marca-icone
PASTA = Path(__file__).resolve().parent.parent / "icones"


def desenhar(tamanho, margem):
    """margem: fração do lado que fica livre em volta do desenho (0.1 = 10%)."""
    escala = 4  # desenha 4x maior e reduz, para as bordas ficarem lisas
    lado = tamanho * escala
    img = Image.new("RGB", (lado, lado), VERDE)
    d = ImageDraw.Draw(img)

    # Mesmas coordenadas do SVG da marca (viewBox 0 0 40 40), desenho entre x 6..34 e y 7..35.
    area = lado * (1 - 2 * margem)
    u = area / 28
    x0 = lado * margem - 6 * u
    y0 = (lado - 28 * u) / 2 - 7 * u

    def p(x, y):
        return (x0 + x * u, y0 + y * u)

    # casa em contorno: M6 19 L20 7 L34 19 V35 H6 Z (cantos de baixo arredondados no SVG; aqui retos)
    traco = round(2.5 * u)
    contorno = [p(6, 19), p(20, 7), p(34, 19), p(34, 35), p(6, 35), p(6, 19)]
    d.line(contorno, fill=DOURADO, width=traco, joint="curve")
    for x, y in contorno:
        cx, cy = x, y
        d.ellipse([cx - traco / 2, cy - traco / 2, cx + traco / 2, cy + traco / 2], fill=DOURADO)

    # coração: M20 30 s-6-3.6-6-8 a3.2 3.2 0 0 1 6-1.6 a3.2 3.2 0 0 1 6 1.6 c0 4.4-6 8-6 8Z
    r = 3.2 * u
    for cx in (17.0, 23.0):
        x, y = p(cx, 21.6)
        d.ellipse([x - r, y - r, x + r, y + r], fill=DOURADO)
    d.polygon([p(14.57, 23.69), p(20, 20.4), p(25.43, 23.69), p(20, 30)], fill=DOURADO)  # tangentes aos círculos

    return img.resize((tamanho, tamanho), Image.LANCZOS)


def main():
    PASTA.mkdir(exist_ok=True)
    desenhar(192, 0.16).save(PASTA / "icone-192.png")
    desenhar(512, 0.16).save(PASTA / "icone-512.png")
    desenhar(512, 0.26).save(PASTA / "icone-maskable-512.png")
    desenhar(180, 0.16).save(PASTA / "icone-apple-180.png")  # iPhone
    print("Ícones gerados em", PASTA)


if __name__ == "__main__":
    main()
