#version 330

// Portrait : on vérifie que la face fait bien 68 × 70 px à l'écran (rapport
// mesuré par les dérivées, indépendant de l'échelle d'interface), puis on
// lance des rayons dans la skin (include/enderium_portrait.glsl).

#moj_import <minecraft:dynamictransforms.glsl>

uniform sampler2D Sampler0;

#moj_import <minecraft:enderium_portrait.glsl>

in vec4 vertexColor;
in vec2 texCoord0;
flat in vec3 portraitBackdropColor;

out vec4 fragColor;

void main() {
    vec2 portraitTexel = texCoord0 * 64.0;
    vec2 portraitDx = dFdx(portraitTexel);
    vec2 portraitDy = dFdy(portraitTexel);
    if (portraitBackdropColor.x >= 0.0 && abs(portraitDx.x) > 0.0 && abs(portraitDy.y) > 0.0) {
        bool aligned = abs(portraitDx.y) + abs(portraitDy.x) < 0.01 * (abs(portraitDx.x) + abs(portraitDy.y));
        float ratio = abs(portraitDy.y) / abs(portraitDx.x);
        if (aligned && abs(ratio - PORTRAIT_FACE_RATIO) < 0.008) {
            // Le chapeau (texels 32 et plus) déborderait : seule la couche de base porte le portrait
            if (portraitTexel.x >= 32.0) {
                discard;
            }
            vec2 uv = clamp((portraitTexel - vec2(8.0)) / 8.0, 0.0, 1.0);
            if (portraitDx.x < 0.0) {
                uv.x = 1.0 - uv.x;
            }
            fragColor = portraitRender(uv, portraitBackdropColor);
            return;
        }
    }

    // Toute autre face : rendu normal de la skin
    vec4 color = texture(Sampler0, texCoord0);
    if (color.a < 0.1) {
        discard;
    }
    fragColor = color * vertexColor * ColorModulator;
}
