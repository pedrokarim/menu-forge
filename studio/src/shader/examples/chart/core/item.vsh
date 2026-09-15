#version 330

// Courbe de prix (technique d'Enderium). Le graphe est une rangée de colonnes :
// une par segment de la courbe. Le serveur écrit les deux valeurs de chaque
// segment dans la TEINTE de sa colonne ; le shader les relit et trace la ligne.
// Détail du codage : include/enderium_chart.glsl.

#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>

in vec3 Position;
in vec4 Color;
in vec2 UV0;

out vec4 vertexColor;
out vec2 texCoord0;

// La teinte brute, qui porte les données (« flat » : pas d'interpolation, sinon les bits se mélangent)
flat out vec3 chartPacked;

void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    vertexColor = Color;
    texCoord0 = UV0;
    chartPacked = Color.rgb;
}
