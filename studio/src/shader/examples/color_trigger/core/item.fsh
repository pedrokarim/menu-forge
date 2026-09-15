#version 330

// Effet activé par la teinte #FFFD01 (voir item.vsh) : bandes arc-en-ciel
// en diagonale qui défilent. Toute autre teinte : rendu normal.

#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:globals.glsl>

uniform sampler2D Sampler0;

in vec4 vertexColor;
in vec2 texCoord0;
flat in float effect;

out vec4 fragColor;

// Teinte (0..1) → couleur vive
vec3 hue(float h) {
    vec3 k = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0;
    return clamp(k, 0.0, 1.0);
}

void main() {
    vec4 color = texture(Sampler0, texCoord0) * vertexColor;
    if (color.a < 0.1) {
        discard;
    }
    if (effect > 0.5) {
        float band = (texCoord0.x + texCoord0.y) * 1.5 - GameTime * 400.0;
        // On garde les ombres de la texture et on remplace sa couleur
        float light = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color.rgb = hue(fract(band)) * (0.35 + 0.65 * light);
    }
    fragColor = color * ColorModulator;
}
