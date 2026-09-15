#version 330

// Courbes des interfaces (Enderium) : un item « graphe » est fait de colonnes, une par segment de
// la courbe (ou par barre, par chandelier). Chaque colonne porte ses données dans la couleur de sa
// teinte (custom_model_data, 24 bits). La texture de la colonne (item/ui/chart_field*, 256 × 256)
// donne la position dans la colonne : rouge = x (gauche → droite), vert = y (haut → bas),
// alpha = CHART_MARKER_A, et le STYLE dans le bleu : CHART_STYLE_BASE + style.
//
//   style 0, aire       : bits 23..13 valeur de gauche, 12..2 valeur de droite (0..2047),
//                         bit 1 hausse, bit 0 dernière colonne ; ligne, aire en dégradé, grille, point
//   style 1, ligne      : même codage ; ligne, grille, point, sans aire
//   style 2, mini       : même codage ; ligne fine et aire légère, sans grille (lignes de liste)
//   style 3, barres     : bits 23..13 hauteur de la barre, bit 1 hausse sur la barre précédente,
//                         bit 0 dernière barre (plus claire)
//   style 4, chandelier : bits 23..18 ouverture, 17..12 fermeture, 11..6 plus haut, 5..0 plus bas (0..63)
//   style 5, prix+volume: bits 23..16 prix à gauche, 15..8 prix à droite (0..255), 7..2 volume (0..63),
//                         bit 1 hausse, bit 0 dernière colonne ; prix en haut, volume en barres en bas
//
// Toute autre texture garde le rendu vanilla. Côté serveur, le codage est fait par Enderium
// (ChartSeries, ChartStyle).

const float CHART_STYLE_BASE = 167.0;
const float CHART_STYLE_COUNT = 6.0;
const float CHART_MARKER_A = 251.0;
const float CHART_FIELD = 256.0;

const int CHART_AREA = 0;
const int CHART_LINE = 1;
const int CHART_SPARK = 2;
const int CHART_BARS = 3;
const int CHART_CANDLES = 4;
const int CHART_VOLUME = 5;

const vec3 CHART_UP = vec3(0.42, 0.86, 0.47);
const vec3 CHART_DOWN = vec3(0.94, 0.40, 0.36);
const vec3 CHART_NEUTRAL = vec3(0.62, 0.64, 0.72);

bool chartIsField(vec4 texel) {
    float b = texel.b * 255.0;
    return abs(texel.a * 255.0 - CHART_MARKER_A) < 0.5 && b > CHART_STYLE_BASE - 0.5 && b < CHART_STYLE_BASE + CHART_STYLE_COUNT - 0.5;
}

int chartStyle(vec4 texel) {
    return int(floor(texel.b * 255.0 + 0.5) - CHART_STYLE_BASE);
}

// Position continue dans la colonne (0..1), à partir du texel et de sa fraction. Les coordonnées de
// texture du modèle sont rentrées d'un demi-texel (le bord d'une colonne ne lit jamais la texture voisine
// de l'atlas) : de 0,5 à 255,5, ramenées ici à 0..1.
vec2 chartLocal(vec4 texel, vec2 uv, vec2 atlasSize) {
    vec2 cell = floor(vec2(texel.r, texel.g) * 255.0 + 0.5);
    return clamp((cell + fract(uv * atlasSize) - 0.5) / (CHART_FIELD - 1.0), 0.0, 1.0);
}

float chartDistancePx(float f, vec2 gradient) {
    return abs(f) / max(length(gradient), 1e-6);
}

// Couche `alpha` de `rgb` posée sur `color` (couleur non prémultipliée, opacité cumulée).
vec4 chartOver(vec4 color, vec3 rgb, float alpha) {
    return vec4(mix(color.rgb, rgb, alpha), max(color.a, alpha));
}

// Grille : trois lignes horizontales discrètes entre `bottom` et 1 (hauteur de la zone).
vec4 chartGrid(vec4 color, float value, vec2 dx, vec2 dy, float gridHalf, float bottom) {
    for (int i = 1; i <= 3; i++) {
        float level = mix(bottom, 1.0, float(i) * 0.25);
        float gd = chartDistancePx(value - level, vec2(-dx.y, -dy.y));
        color = chartOver(color, vec3(1.0), clamp(gridHalf + 0.5 - gd, 0.0, 1.0) * 0.16);
    }
    return color;
}

// Segment de `a` (gauche) à `b` (droite) : aire dessous si demandée, ligne lissée à bouts arrondis (les
// colonnes voisines se rejoignent sans encoche), point final. Dans la dernière colonne, la ligne s'arrête
// avant le bord pour que le point final soit entier.
vec4 chartSegment(vec4 color, vec2 local, float value, float a, float b, vec2 dx, vec2 dy, vec3 accent,
                  float lineHalf, float areaTop, float areaBottom, float floorValue, bool last, float discRadius,
                  float widthPx, float heightPx) {
    float reserve = last && discRadius > 0.0 ? clamp((discRadius * 1.45 + 1.0) / widthPx, 0.0, 0.5) : 0.0;
    float end = 1.0 - reserve;
    float t = clamp(local.x / end, 0.0, 1.0);
    float slope = (b - a) / end;
    float line = mix(a, b, t);
    float f = value - line;
    vec2 gradient = vec2(-dx.y - slope * dx.x, -dy.y - slope * dy.x);
    float dist = local.x <= end ? chartDistancePx(f, gradient) : 1e6;
    // Bouts arrondis : distance aux deux extrémités du segment, en pixels d'écran
    float toStart = length(vec2(local.x * widthPx, (value - a) * heightPx));
    float toEnd = length(vec2((local.x - end) * widthPx, (value - b) * heightPx));
    dist = min(dist, min(toStart, toEnd));
    if (f < 0.0 && local.x <= end && value >= floorValue && areaTop > 0.0) {
        float depth = clamp((value - floorValue) / max(line - floorValue, 1e-3), 0.0, 1.0);
        color = chartOver(color, accent, mix(areaBottom, areaTop, depth * depth));
    }
    color = chartOver(color, mix(accent, vec3(1.0), 0.15), clamp(lineHalf + 0.5 - dist, 0.0, 1.0));
    if (last && discRadius > 0.0) {
        float disc = clamp(discRadius + 0.5 - toEnd, 0.0, 1.0);
        float ring = clamp(discRadius * 1.45 + 0.5 - toEnd, 0.0, 1.0) - disc;
        color = chartOver(color, vec3(1.0), ring);
        color = chartOver(color, accent, disc);
    }
    return color;
}

// Rectangle plein de `x0` à `x1` (fraction de colonne) et de `y0` à `y1` (valeur), bords lissés au pixel.
float chartBox(vec2 local, float value, float x0, float x1, float y0, float y1, float widthPx, float heightPx) {
    float ax = clamp((local.x - x0) * widthPx + 0.5, 0.0, 1.0) * clamp((x1 - local.x) * widthPx + 0.5, 0.0, 1.0);
    float ay = clamp((value - y0) * heightPx + 0.5, 0.0, 1.0) * clamp((y1 - value) * heightPx + 0.5, 0.0, 1.0);
    return ax * ay;
}

// uvDx, uvDy : dFdx / dFdy des coordonnées de texture, calculés par l'appelant hors de toute condition.
vec4 chartRender(vec4 texel, vec2 uv, vec2 uvDx, vec2 uvDy, vec2 atlasSize, vec3 packedColor) {
    ivec3 c = ivec3(round(packedColor * 255.0));
    int bits = (c.r << 16) | (c.g << 8) | c.b;
    int style = chartStyle(texel);

    vec2 local = chartLocal(texel, uv, atlasSize);
    // Dérivées écran de la position locale, calculées sur les coordonnées de texture continues
    vec2 dx = uvDx * atlasSize / CHART_FIELD;
    vec2 dy = uvDy * atlasSize / CHART_FIELD;
    float value = 1.0 - local.y;

    // Tailles relatives à la hauteur du graphe (en pixels écran) : même allure à toute échelle d'interface
    float heightPx = 1.0 / max(length(vec2(dx.y, dy.y)), 1e-6);
    float widthPx = 1.0 / max(length(vec2(dx.x, dy.x)), 1e-6);
    float lineHalf = max(0.75, heightPx * 0.011);
    float gridHalf = max(0.5, heightPx * 0.005);
    float discRadius = max(2.5, heightPx * 0.04);
    bool up = ((bits >> 1) & 1) == 1;
    bool last = (bits & 1) == 1;
    vec3 accent = up ? CHART_UP : CHART_DOWN;
    vec4 color = vec4(0.0);

    if (style == CHART_AREA || style == CHART_LINE) {
        float v0 = float((bits >> 13) & 2047) / 2047.0;
        float v1 = float((bits >> 2) & 2047) / 2047.0;
        color = chartGrid(color, value, dx, dy, gridHalf, 0.0);
        float areaTop = style == CHART_AREA ? 0.45 : 0.0;
        color = chartSegment(color, local, value, v0, v1, dx, dy, accent, lineHalf, areaTop, 0.08, 0.0, last, discRadius, widthPx, heightPx);
    } else if (style == CHART_SPARK) {
        // Mini-courbe : pour une ligne de liste ; ni grille ni point, trait d'un pixel d'écran environ.
        float v0 = float((bits >> 13) & 2047) / 2047.0;
        float v1 = float((bits >> 2) & 2047) / 2047.0;
        float sparkHalf = max(0.6, heightPx * 0.02);
        color = chartSegment(color, local, value, v0, v1, dx, dy, accent, sparkHalf, 0.28, 0.04, 0.0, false, 0.0, widthPx, heightPx);
    } else if (style == CHART_BARS) {
        // Barre centrée, un vide d'au moins un pixel de chaque côté ; la dernière est plus claire.
        float v = float((bits >> 13) & 2047) / 2047.0;
        color = chartGrid(color, value, dx, dy, gridHalf, 0.0);
        float gap = clamp(max(1.0, widthPx * 0.14) / widthPx, 0.0, 0.45);
        float body = chartBox(local, value, gap, 1.0 - gap, 0.0, v, widthPx, heightPx);
        vec3 fill = mix(accent, vec3(1.0), last ? 0.25 : 0.0);
        color = chartOver(color, fill * (last ? 1.0 : 0.82), body * 0.9);
        // Arête haute plus claire, d'un pixel
        float edge = chartBox(local, value, gap, 1.0 - gap, v - 1.0 / heightPx, v, widthPx, heightPx);
        color = chartOver(color, mix(fill, vec3(1.0), 0.35), edge);
    } else if (style == CHART_CANDLES) {
        float open = float((bits >> 18) & 63) / 63.0;
        float close = float((bits >> 12) & 63) / 63.0;
        float high = float((bits >> 6) & 63) / 63.0;
        float low = float(bits & 63) / 63.0;
        vec3 tone = close >= open ? CHART_UP : CHART_DOWN;
        color = chartGrid(color, value, dx, dy, gridHalf, 0.0);
        // Mèche d'au moins un pixel, corps de 60 % de la colonne, d'au moins un pixel de haut
        float wick = max(1.0, widthPx * 0.1) / widthPx * 0.5;
        color = chartOver(color, tone * 0.85, chartBox(local, value, 0.5 - wick, 0.5 + wick, low, high, widthPx, heightPx));
        float top = max(open, close);
        float bottom = min(open, close);
        top = max(top, bottom + 1.0 / heightPx);
        color = chartOver(color, tone, chartBox(local, value, 0.2, 0.8, bottom, top, widthPx, heightPx));
    } else if (style == CHART_VOLUME) {
        // Prix dans les 72 % du haut, volume en barres dans les 24 % du bas, 4 % d'écart entre les deux.
        float p0 = float((bits >> 16) & 255) / 255.0;
        float p1 = float((bits >> 8) & 255) / 255.0;
        float volume = float((bits >> 2) & 63) / 63.0;
        const float volumeTop = 0.24;
        const float priceBottom = 0.28;
        color = chartGrid(color, value, dx, dy, gridHalf, priceBottom);
        // La dernière colonne est élargie pour le point final : sa barre garde la largeur des autres.
        float reserve = last ? clamp((discRadius * 1.45 + 1.0) / widthPx, 0.0, 0.5) : 0.0;
        float barWidthPx = widthPx * (1.0 - reserve);
        float gap = clamp(max(1.0, barWidthPx * 0.14) / widthPx, 0.0, 0.45);
        float bar = chartBox(local, value, gap, 1.0 - reserve - gap, 0.0, volume * volumeTop, widthPx, heightPx);
        color = chartOver(color, mix(CHART_NEUTRAL, accent, 0.35), bar * 0.55);
        float a = mix(priceBottom, 1.0, p0);
        float b = mix(priceBottom, 1.0, p1);
        color = chartSegment(color, local, value, a, b, dx, dy, accent, lineHalf, 0.40, 0.06, priceBottom, last, discRadius, widthPx, heightPx);
    }
    return color;
}
