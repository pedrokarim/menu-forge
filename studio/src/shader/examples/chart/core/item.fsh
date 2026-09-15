#version 330

// Courbe de prix : si le pixel appartient à la texture « champ » du graphe, on
// dessine la courbe ; sinon rendu normal. Modifiez les valeurs au-dessus du
// rendu, ou les couleurs et épaisseurs dans include/enderium_chart.glsl.

#moj_import <minecraft:dynamictransforms.glsl>

uniform sampler2D Sampler0;

#moj_import <minecraft:enderium_chart.glsl>

in vec4 vertexColor;
in vec2 texCoord0;
flat in vec3 chartPacked;

out vec4 fragColor;

void main() {
    vec4 color = texture(Sampler0, texCoord0);

    // Les dérivées (variation d'un pixel à l'autre) doivent se calculer hors de toute condition
    vec2 chartDx = dFdx(texCoord0);
    vec2 chartDy = dFdy(texCoord0);
    if (chartIsField(color)) {
        vec4 chart = chartRender(color, texCoord0, chartDx, chartDy, vec2(textureSize(Sampler0, 0)), chartPacked);
        if (chart.a < 0.01) {
            discard;
        }
        fragColor = chart;
        return;
    }

    if (color.a < 0.1) {
        discard;
    }
    fragColor = color * vertexColor * ColorModulator;
}
