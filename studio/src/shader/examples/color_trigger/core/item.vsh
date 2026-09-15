#version 330

// Déclencheur par couleur : le serveur ne peut pas envoyer de données à un
// shader, mais il choisit la teinte des objets. Une teinte précise, que
// personne n'utilise, sert donc de « code secret » qui active un effet.

#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>

in vec3 Position;
in vec4 Color;
in vec2 UV0;

out vec4 vertexColor;
out vec2 texCoord0;
flat out float effect; // « flat » : même valeur pour tout le quad, sans interpolation

// Le code : #FFFD01 (rouge 255, vert 253, bleu 1)
const vec3 TRIGGER = vec3(255.0, 253.0, 1.0);

void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    texCoord0 = UV0;

    // On compare en entiers 0..255 : les flottants ne tombent jamais pile
    vec3 rgb = floor(Color.rgb * 255.0 + 0.5);
    if (all(equal(rgb, TRIGGER))) {
        effect = 1.0;
        vertexColor = vec4(1.0); // la teinte servait de code : on ne l'applique pas
    } else {
        effect = 0.0;
        vertexColor = Color;
    }
}
