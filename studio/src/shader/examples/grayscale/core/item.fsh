#version 330

// Noir et blanc : chaque pixel prend sa luminosité perçue, puis on mélange
// avec la couleur d'origine selon STRENGTH.

#moj_import <minecraft:dynamictransforms.glsl>

uniform sampler2D Sampler0;

in vec4 vertexColor;
in vec2 texCoord0;

out vec4 fragColor;

// 0.0 = couleurs d'origine, 1.0 = entièrement gris. Essayez 0.5.
const float STRENGTH = 1.0;

void main() {
    vec4 color = texture(Sampler0, texCoord0) * vertexColor;
    if (color.a < 0.1) {
        discard;
    }
    // L'œil voit le vert plus clair que le rouge, et le rouge plus clair que le bleu
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(mix(color.rgb, vec3(gray), STRENGTH), color.a) * ColorModulator;
}
