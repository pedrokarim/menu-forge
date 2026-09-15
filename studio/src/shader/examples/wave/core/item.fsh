#version 330

// Vague animée : on décale l'endroit où on lit la texture, d'une quantité
// qui dépend de la hauteur du pixel et du temps. Cochez « Animer GameTime ».

#moj_import <minecraft:dynamictransforms.glsl>
// GameTime : de 0 à 1 en un jour du jeu (20 minutes)
#moj_import <minecraft:globals.glsl>

uniform sampler2D Sampler0;

in vec4 vertexColor;
in vec2 texCoord0;

out vec4 fragColor;

const float AMPLITUDE = 0.04; // largeur de l'ondulation, en fraction de la texture
const float WAVES = 2.0;      // nombre de vagues sur la hauteur
const float SPEED = 600.0;    // tours par jour du jeu (600 = un tour toutes les 2 s)

void main() {
    float phase = 6.2831 * (texCoord0.y * WAVES + GameTime * SPEED);
    vec2 uv = texCoord0 + vec2(sin(phase) * AMPLITUDE, 0.0);

    // En dehors de la texture après décalage : transparent
    if (uv.x < 0.0 || uv.x > 1.0) {
        discard;
    }
    vec4 color = texture(Sampler0, uv) * vertexColor;
    if (color.a < 0.1) {
        discard;
    }
    fragColor = color * ColorModulator;
}
