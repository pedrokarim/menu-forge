#version 330

// VERTEX SHADER : exécuté une fois par sommet (les 4 coins de chaque quad).
// Son travail : dire OÙ le coin apparaît à l'écran, et transmettre au
// fragment shader ce dont il aura besoin (couleur, coordonnées de texture).

#moj_import <minecraft:dynamictransforms.glsl>
#moj_import <minecraft:projection.glsl>

// Ce que le jeu envoie pour chaque sommet
in vec3 Position; // position du coin, en pixels d'interface
in vec4 Color;    // teinte du sommet (blanc = aucune teinte)
in vec2 UV0;      // coordonnées dans la texture (0..1)

// Ce qu'on transmet au fragment shader (interpolé entre les coins)
out vec4 vertexColor;
out vec2 texCoord0;

void main() {
    // Pixels d'interface → écran : les deux matrices du jeu font la conversion
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    vertexColor = Color;
    texCoord0 = UV0;
}
