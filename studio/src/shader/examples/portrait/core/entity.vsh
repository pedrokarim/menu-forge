#version 330

// Portrait du profil (technique d'Enderium). Le jeu dessine une tête de joueur
// dans l'interface ; le shader reconnaît sa face avant (taille inhabituelle,
// 68 × 70 px) et la remplace par un buste en 3D calculé dans la skin.
// Chargez votre skin (PNG 64 × 64) au-dessus du rendu.

#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>

in vec3 Position;
in vec4 Color;
in vec2 UV0;
in vec3 Normal;

uniform sampler2D Sampler0; // la skin, lue dès le vertex shader

#moj_import <minecraft:enderium_portrait.glsl>

out vec4 vertexColor;
out vec2 texCoord0;

// Teinte du fond, négative quand ce quad n'est pas une face avant de tête
flat out vec3 portraitBackdropColor;

void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    vertexColor = Color;
    texCoord0 = UV0;

    portraitBackdropColor = vec3(-1.0);
    // Interface (projection orthographique), face tournée vers l'écran, texture 64 × 64, zone du visage
    if (ProjMat[2][3] == 0.0 && abs(Normal.z) > 0.99
        && textureSize(Sampler0, 0) == ivec2(64) && portraitFrontTexel(UV0 * 64.0)) {
        portraitBackdropColor = portraitBackdrop();
    }
}
