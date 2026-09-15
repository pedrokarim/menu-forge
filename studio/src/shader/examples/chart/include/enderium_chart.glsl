#version 330

// Courbes des interfaces (Enderium) : un item « graphe » est fait de colonnes, une par segment de
// la courbe. Chaque colonne porte, dans la couleur de sa teinte (custom_model_data), les deux
// valeurs de son segment et un style :
//   bits 23..13 : valeur de gauche (0..2047) ; bits 12..2 : valeur de droite ; bit 1 : hausse ;
//   bit 0 : dernière colonne.
// La texture de la colonne (item/ui/chart_field, 256 × 256) donne la position dans la colonne :
// rouge = x (gauche → droite), vert = y (haut → bas), bleu = CHART_MARKER_B, alpha = CHART_MARKER_A.
// Toute autre texture garde le rendu vanilla. Côté serveur, le codage est fait par Enderium (ChartSeries).

const float CHART_MARKER_B = 167.0;
const float CHART_MARKER_A = 251.0;
const float CHART_FIELD = 256.0;

bool chartIsField(vec4 texel) {
    return abs(texel.b * 255.0 - CHART_MARKER_B) < 0.5 && abs(texel.a * 255.0 - CHART_MARKER_A) < 0.5;
}

// Position continue dans la colonne (0..1), à partir du texel et de sa fraction.
vec2 chartLocal(vec4 texel, vec2 uv, vec2 atlasSize) {
    vec2 cell = floor(vec2(texel.r, texel.g) * 255.0 + 0.5);
    return (cell + fract(uv * atlasSize)) / CHART_FIELD;
}

float chartDistancePx(float f, vec2 gradient) {
    return abs(f) / max(length(gradient), 1e-6);
}

// uvDx, uvDy : dFdx / dFdy des coordonnées de texture, calculés par l'appelant hors de toute condition.
vec4 chartRender(vec4 texel, vec2 uv, vec2 uvDx, vec2 uvDy, vec2 atlasSize, vec3 packedColor) {
    ivec3 c = ivec3(round(packedColor * 255.0));
    int bits = (c.r << 16) | (c.g << 8) | c.b;
    float v0 = float((bits >> 13) & 2047) / 2047.0;
    float v1 = float((bits >> 2) & 2047) / 2047.0;
    bool up = ((bits >> 1) & 1) == 1;
    bool last = (bits & 1) == 1;

    vec2 local = chartLocal(texel, uv, atlasSize);
    // Dérivées écran de la position locale, calculées sur les coordonnées de texture continues
    vec2 dx = uvDx * atlasSize / CHART_FIELD;
    vec2 dy = uvDy * atlasSize / CHART_FIELD;

    float value = 1.0 - local.y;
    float line = mix(v0, v1, local.x);
    float f = value - line;
    vec2 gradient = vec2(-dx.y - (v1 - v0) * dx.x, -dy.y - (v1 - v0) * dy.x);
    float dist = chartDistancePx(f, gradient);

    vec3 accent = up ? vec3(0.42, 0.86, 0.47) : vec3(0.94, 0.40, 0.36);
    // Tailles relatives à la hauteur du graphe (en pixels écran) : même allure à toute échelle d'interface
    float heightPx = 1.0 / max(length(vec2(dx.y, dy.y)), 1e-6);
    float lineHalf = max(0.75, heightPx * 0.011);
    float gridHalf = max(0.5, heightPx * 0.005);
    float discRadius = max(2.5, heightPx * 0.04);
    vec4 color = vec4(0.0);

    // Grille : quatre lignes horizontales discrètes
    for (int i = 1; i <= 3; i++) {
        float g = value - float(i) * 0.25;
        float gd = chartDistancePx(g, vec2(-dx.y, -dy.y));
        float a = clamp(gridHalf + 0.5 - gd, 0.0, 1.0) * 0.16;
        color = vec4(mix(color.rgb, vec3(1.0), a), max(color.a, a));
    }

    // Aire sous la courbe : dégradé de l'accent, plus dense près de la ligne
    if (f < 0.0) {
        float depth = clamp(value / max(line, 1e-3), 0.0, 1.0);
        float a = mix(0.08, 0.45, depth * depth);
        color = vec4(mix(color.rgb, accent, a), max(color.a, a));
    }

    // Ligne, lissée sur un pixel
    float lineAlpha = clamp(lineHalf + 0.5 - dist, 0.0, 1.0);
    color = vec4(mix(color.rgb, mix(accent, vec3(1.0), 0.15), lineAlpha), max(color.a, lineAlpha));

    // Dernier point : un disque au bout de la courbe
    if (last) {
        vec2 toEnd = vec2((1.0 - local.x) / max(abs(dx.x) + abs(dy.x), 1e-6), (value - v1) / max(abs(dx.y) + abs(dy.y), 1e-6));
        float r = length(toEnd);
        float disc = clamp(discRadius + 0.5 - r, 0.0, 1.0);
        float ring = clamp(discRadius * 1.45 + 0.5 - r, 0.0, 1.0) - disc;
        color = vec4(mix(color.rgb, vec3(1.0), ring), max(color.a, ring));
        color = vec4(mix(color.rgb, accent, disc), max(color.a, disc));
    }
    return color;
}
