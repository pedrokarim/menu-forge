#version 330

// Portrait du profil d’Enderium (clients 26.x) : buste du joueur (tête, torse,
// bras, calques compris) vu de trois quarts, calculé par lancer de rayons dans
// la skin, sur un fond dégradé teinté d'après la skin.
//
// Le portrait est la face avant d’une tête de joueur à modèle dédié : une face
// de 68 × 70 px, la seule face de tête de joueur qui ne soit pas carrée. Le
// vertex shader repère les faces avant de skin vues de face dans l'interface et
// calcule la teinte du fond ; le fragment shader vérifie le rapport 68/70 par
// les dérivées des coordonnées de texture, qui ne dépendent pas de l'échelle
// de l'interface. Toute autre tête garde le rendu vanilla.
//
// À inclure après la déclaration de Sampler0. Unités : pixels de skin, le
// personnage regarde vers +z, son côté droit est en −x.

const float PORTRAIT_FACE_RATIO = 68.0 / 70.0;
const float PORTRAIT_FAR = 10000.0;

// Face avant de la tête (couche de base ou chapeau), en texels de skin.
bool portraitFrontTexel(vec2 texel) {
    return texel.y >= 7.9 && texel.y <= 16.1
        && ((texel.x >= 7.9 && texel.x <= 16.1) || (texel.x >= 39.9 && texel.x <= 48.1));
}

// Teinte du fond : moyenne des couleurs du dessus de la tête et du devant du
// torse, pondérée par la saturation (les teintes vives l'emportent sur le gris
// et la peau), ramenée à une luminosité fixe.
vec3 portraitBackdrop() {
    const ivec4 regions[4] = ivec4[](
        ivec4(8, 0, 8, 8), ivec4(40, 0, 8, 8), ivec4(20, 20, 8, 12), ivec4(20, 36, 8, 12));
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int r = 0; r < 4; r++) {
        for (int y = regions[r].y; y < regions[r].y + regions[r].w; y++) {
            for (int x = regions[r].x; x < regions[r].x + regions[r].z; x++) {
                vec4 c = texelFetch(Sampler0, ivec2(x, y), 0);
                if (c.a < 0.5) continue;
                float high = max(max(c.r, c.g), c.b);
                float low = min(min(c.r, c.g), c.b);
                float saturation = (high - low) / (high + 0.0001);
                float k = saturation * saturation + 0.02;
                sum += c.rgb * k;
                weight += k;
            }
        }
    }
    vec3 color = sum / max(weight, 0.0001);
    return color * (0.55 / max(max(max(color.r, color.g), color.b), 0.0001));
}

struct PortraitHit {
    float t;
    vec3 normal;
    vec4 albedo;
};

// Texel touché sur une boîte de demi-taille h, dont la bande de texture
// commence en origin et mesure size = (largeur, hauteur, profondeur).
vec2 portraitFaceTexel(vec3 p, vec3 n, vec3 h, vec2 origin, vec3 size) {
    const float EDGE = 0.999;
    float w = size.x, height = size.y, d = size.z;
    float side = clamp((h.y - p.y) / (2.0 * h.y), 0.0, EDGE);
    if (n.z > 0.5) return origin + vec2(d + clamp((p.x + h.x) / (2.0 * h.x), 0.0, EDGE) * w, d + side * height);
    if (n.z < -0.5) return origin + vec2(2.0 * d + w + clamp((h.x - p.x) / (2.0 * h.x), 0.0, EDGE) * w, d + side * height);
    if (n.x < -0.5) return origin + vec2(clamp((p.z + h.z) / (2.0 * h.z), 0.0, EDGE) * d, d + side * height);
    if (n.x > 0.5) return origin + vec2(d + w + clamp((h.z - p.z) / (2.0 * h.z), 0.0, EDGE) * d, d + side * height);
    if (n.y > 0.5) return origin + vec2(d + clamp((p.x + h.x) / (2.0 * h.x), 0.0, EDGE) * w, clamp((p.z + h.z) / (2.0 * h.z), 0.0, EDGE) * d);
    return origin + vec2(d + w + clamp((p.x + h.x) / (2.0 * h.x), 0.0, EDGE) * w, clamp((h.z - p.z) / (2.0 * h.z), 0.0, EDGE) * d);
}

// Boîte centrée en center, inclinée de tilt autour de z ; garde le texel
// opaque le plus proche.
void portraitBox(inout PortraitHit best, vec3 origin, vec3 direction, vec3 center, vec3 h, float tilt, vec2 uvOrigin, vec3 uvSize) {
    float c = cos(tilt);
    float s = sin(tilt);
    mat3 toBox = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
    vec3 o = toBox * (origin - center);
    vec3 d = toBox * direction;
    vec3 inverse = 1.0 / d;
    vec3 t1 = (-h - o) * inverse;
    vec3 t2 = (h - o) * inverse;
    vec3 tMin = min(t1, t2);
    vec3 tMax = max(t1, t2);
    float near = max(max(tMin.x, tMin.y), tMin.z);
    float far = min(min(tMax.x, tMax.y), tMax.z);
    if (near > far || near < 0.0 || near >= best.t) return;
    vec3 n = near == tMin.x ? vec3(-sign(d.x), 0.0, 0.0)
        : near == tMin.y ? vec3(0.0, -sign(d.y), 0.0)
        : vec3(0.0, 0.0, -sign(d.z));
    vec2 texel = portraitFaceTexel(o + d * near, n, h, uvOrigin, uvSize);
    vec4 albedo = texelFetch(Sampler0, clamp(ivec2(floor(texel)), ivec2(0), ivec2(63)), 0);
    if (albedo.a < 0.1) return;
    best = PortraitHit(near, transpose(toBox) * n, albedo);
}

// Calques d'abord (plus grands), puis couches de base ; grow épaissit tout
// (contour).
PortraitHit portraitTrace(vec3 origin, vec3 direction, float grow, bool slim) {
    float arm = slim ? 1.5 : 2.0;
    float armX = slim ? 5.5 : 6.0;
    float armWidth = slim ? 3.0 : 4.0;
    float tilt = radians(6.0);
    PortraitHit best = PortraitHit(PORTRAIT_FAR, vec3(0.0), vec4(0.0));

    portraitBox(best, origin, direction, vec3(0.0, 6.0, 0.0), vec3(4.0, 6.0, 2.0) + 0.25 + grow, 0.0, vec2(16.0, 32.0), vec3(8.0, 12.0, 4.0));
    portraitBox(best, origin, direction, vec3(-armX, 6.0, 0.0), vec3(arm, 6.0, 2.0) + 0.25 + grow, -tilt, vec2(40.0, 32.0), vec3(armWidth, 12.0, 4.0));
    portraitBox(best, origin, direction, vec3(armX, 6.0, 0.0), vec3(arm, 6.0, 2.0) + 0.25 + grow, tilt, vec2(48.0, 48.0), vec3(armWidth, 12.0, 4.0));
    portraitBox(best, origin, direction, vec3(0.0, 16.0, 0.0), vec3(4.0) + 0.5 + grow, 0.0, vec2(32.0, 0.0), vec3(8.0));

    portraitBox(best, origin, direction, vec3(0.0, 6.0, 0.0), vec3(4.0, 6.0, 2.0) + grow, 0.0, vec2(16.0, 16.0), vec3(8.0, 12.0, 4.0));
    portraitBox(best, origin, direction, vec3(-armX, 6.0, 0.0), vec3(arm, 6.0, 2.0) + grow, -tilt, vec2(40.0, 16.0), vec3(armWidth, 12.0, 4.0));
    portraitBox(best, origin, direction, vec3(armX, 6.0, 0.0), vec3(arm, 6.0, 2.0) + grow, tilt, vec2(32.0, 48.0), vec3(armWidth, 12.0, 4.0));
    portraitBox(best, origin, direction, vec3(0.0, 16.0, 0.0), vec3(4.0) + grow, 0.0, vec2(0.0, 0.0), vec3(8.0));
    return best;
}

float portraitSoftLight(float base, float blend) {
    return blend < 0.5
        ? 2.0 * base * blend + base * base * (1.0 - 2.0 * blend)
        : sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend);
}

// uv : (0, 0) en haut à gauche du portrait, (1, 1) en bas à droite.
vec4 portraitRender(vec2 uv, vec3 backdrop) {
    bool slim = texelFetch(Sampler0, ivec2(54, 20), 0).a < 0.5;
    vec3 viewDirection = normalize(vec3(1.0, -1.0, -1.0));
    vec3 right = normalize(cross(viewDirection, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, viewDirection);
    vec3 focus = vec3(0.0, 15.0, 0.0) + right * 1.2;
    float viewHeight = 18.5;
    float viewWidth = viewHeight * PORTRAIT_FACE_RATIO;

    vec3 result = backdrop * mix(0.5, 0.25, uv.y);
    vec3 origin = focus - viewDirection * 40.0
        + right * (uv.x - 0.5) * viewWidth
        + up * (0.5 - uv.y) * viewHeight;

    PortraitHit hit = portraitTrace(origin, viewDirection, 0.0, slim);
    if (hit.t >= PORTRAIT_FAR) {
        if (portraitTrace(origin, viewDirection, 0.25, slim).t < PORTRAIT_FAR) result = vec3(0.0);
    } else {
        vec3 light = normalize(vec3(-0.3, 1.0, 0.6));
        result = hit.albedo.rgb * sqrt(0.3 + 0.7 * max(dot(hit.normal, light), 0.0));
    }

    vec3 tone = mix(vec3(0.20, 0.18, 0.14), vec3(0.97, 0.90, 0.74), sqrt(1.0 - uv.y));
    result = vec3(
        portraitSoftLight(result.r, tone.r),
        portraitSoftLight(result.g, tone.g),
        portraitSoftLight(result.b, tone.b));
    return vec4(result, 1.0);
}
