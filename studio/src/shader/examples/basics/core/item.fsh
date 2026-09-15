#version 330

// FRAGMENT SHADER : exécuté une fois par pixel couvert par le quad.
// Son travail : dire de QUELLE COULEUR est ce pixel.

#moj_import <minecraft:dynamictransforms.glsl>

uniform sampler2D Sampler0; // la texture de l'élément

in vec4 vertexColor; // reçus du vertex shader
in vec2 texCoord0;

out vec4 fragColor; // la couleur finale du pixel (rouge, vert, bleu, opacité)

void main() {
    // 1. On lit la texture à cet endroit
    vec4 color = texture(Sampler0, texCoord0);

    // 2. Pixel transparent : on ne dessine rien
    if (color.a < 0.1) {
        discard;
    }

    // 3. On applique la teinte du sommet (essayez une couleur dans « Couleur de sommet »)
    fragColor = color * vertexColor * ColorModulator;
}
