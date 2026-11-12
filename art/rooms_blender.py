# Family Chores: toy-like 3D room dioramas, rendered as 12-angle turntables with transparent backgrounds.
# Run headless:  blender.exe -b -P rooms_blender.py -- <out_dir> [room_slug ...]
import bpy, math, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(__file__), "renders")
ONLY = set(argv[1:])
FRAMES, SIZE, SWING = 12, 480, 22  # angles, pixels, degrees each way

# ---------- palette ----------
P = dict(floor="#D9B48F", wood="#B9773F", wall="#F2C4A0", wall2="#9FD3E6", white="#FAFAF7", steel="#B9C2C9",
         mint="#7FD1B9", teal="#2F6F4F", coral="#FF8A65", sun="#FFC857", sky="#7CB7E8", navy="#2E3A59", pink="#F4A6C1",
         grass="#7DC36B", leaf="#4FA34A", dark="#3B3B3B", lilac="#A98BE6", cream="#FFE08A", red="#E5534B", tile="#BFE3E0")

def hexrgb(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)

MATS = {}
def mat(name):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = hexrgb(P.get(name, name))
    b.inputs["Roughness"].default_value = 0.55
    MATS[name] = m; return m

ROOT = None
TAG = None
def tag(name):
    global TAG; TAG = name
def obj_common(o, color, bevel=0.06):
    o.data.materials.append(mat(color))
    if bevel:
        mod = o.modifiers.new("bevel", "BEVEL"); mod.width = bevel; mod.segments = 3; mod.limit_method = "ANGLE"
    for p in o.data.polygons: p.use_smooth = True
    o.parent = ROOT
    if TAG: o["item"] = TAG
    return o

def box(size, loc, color, bevel=0.06, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[math.radians(r) for r in rot])
    o = bpy.context.object; o.scale = size; bpy.ops.object.transform_apply(scale=True)
    return obj_common(o, color, min(bevel, min(size) / 2.2))

def cyl(r, h, loc, color, rot=(0, 0, 0), verts=24, bevel=0.03):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, vertices=verts, rotation=[math.radians(a) for a in rot])
    return obj_common(bpy.context.object, color, bevel)

def ball(r, loc, color):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=12)
    return obj_common(bpy.context.object, color, 0)

def shell(floor="floor", wall="wall", w=4.0, d=4.0, h=2.6, walls=True, floor_tag="floor"):
    tag(floor_tag); box((w, d, 0.25), (0, 0, -0.125), floor, 0.08); tag(None)
    if walls:
        box((w, 0.2, h), (0, d / 2 - 0.1, h / 2), wall, 0.05)          # back wall
        box((0.2, d, h), (-w / 2 + 0.1, 0, h / 2), wall, 0.05)         # left wall

# ---------- rooms ----------
def kitchen():
    shell(wall="wall2")
    tag("counter"); box((3.2, 0.8, 1.0), (0.1, 1.45, 0.5), "white"); box((3.3, 0.9, 0.08), (0.1, 1.45, 1.04), "wood")   # counter run + worktop
    tag("fridge"); box((0.8, 0.8, 2.1), (-1.45, 1.45, 1.05), "steel")
    tag("sink"); box((0.7, 0.5, 0.06), (0.2, 1.45, 1.1), "steel", 0.02); cyl(0.03, 0.3, (0.2, 1.68, 1.25), "steel")
    tag("stove"); [cyl(0.13, 0.03, (x, 1.35, 1.1), "dark") for x in (0.9, 1.25)]
    tag("cupboard"); box((0.8, 0.35, 0.5), (-0.5, 1.7, 1.8), "wood")
    tag("island"); box((0.8, 1.6, 0.9), (-0.9, -0.9, 0.45), "wood"); box((0.9, 1.7, 0.07), (-0.9, -0.9, 0.93), "white")
    ball(0.12, (-1.1, -1.1, 1.08), "coral"); ball(0.1, (-0.85, -0.8, 1.06), "sun"); ball(0.11, (-0.75, -1.3, 1.07), "leaf")
    tag("bin"); box((0.4, 0.4, 0.55), (1.6, -1.5, 0.28), "teal", 0.06); box((0.44, 0.44, 0.06), (1.6, -1.5, 0.58), "navy", 0.03)
    tag(None); [cyl(0.18, 0.6, (-0.2, y, 0.3), "coral") for y in (-1.4, -0.4)]  # stools
def living_room():
    shell(wall="cream")
    box((3.0, 2.4, 0.04), (0.3, -0.1, 0.02), "lilac", 0.02)         # rug
    box((0.9, 2.4, 0.5), (-1.3, -0.1, 0.25), "teal"); box((0.3, 2.4, 0.6), (-1.75, -0.1, 0.6), "teal")
    for y in (-1.0, 0.8): box((0.9, 0.3, 0.35), (-1.3, y, 0.62), "teal")
    box((0.6, 0.6, 0.12), (-1.25, 0.2, 0.6), "sun", 0.05)           # cushion
    box((1.2, 0.8, 0.35), (0.3, -0.1, 0.18), "wood")                # coffee table
    box((2.0, 0.4, 0.5), (0.6, 1.65, 0.25), "wood")                 # tv unit
    box((1.6, 0.08, 0.9), (0.6, 1.72, 1.05), "dark", 0.02)          # tv
    cyl(0.22, 0.4, (1.6, 1.4, 0.2), "coral"); ball(0.45, (1.6, 1.4, 0.75), "leaf")  # plant
def main_bathroom():
    shell(floor="tile", wall="wall2")
    box((1.6, 0.85, 0.6), (0.9, 1.45, 0.3), "white", 0.18)          # tub
    box((1.4, 0.65, 0.1), (0.9, 1.45, 0.58), "sky", 0.04)
    box((0.55, 0.7, 0.45), (-1.45, -0.2, 0.22), "white", 0.12)      # toilet
    box((0.55, 0.25, 0.7), (-1.65, -0.2, 0.75), "white", 0.08)
    box((0.8, 0.55, 0.85), (-1.45, 1.0, 0.42), "wood")              # vanity
    box((0.55, 0.4, 0.08), (-1.4, 1.0, 0.88), "white", 0.03)
    box((0.06, 0.7, 0.8), (-1.77, 1.0, 1.6), "sky", 0.02)           # mirror
    box((0.9, 0.6, 0.03), (0.4, 0.2, 0.02), "pink", 0.01)           # bath mat
def hallway_and_entry():
    shell(d=4.0, wall="cream")
    box((1.0, 3.4, 0.03), (0.2, -0.2, 0.02), "coral", 0.01)         # runner
    box((0.9, 0.12, 2.0), (0.9, 1.72, 1.0), "wood")                 # door
    ball(0.07, (1.25, 1.64, 1.0), "sun")
    box((0.4, 1.2, 0.5), (-1.6, 0.0, 0.25), "wood")                 # shoe bench
    for y in (-0.35, 0.0, 0.35): box((0.25, 0.14, 0.12), (-1.55, y, 0.56), ["navy", "red", "mint"][int((y + 0.35) / 0.35)], 0.04)
    for z, c in ((1.5, "sky"), (1.9, "sun")): box((0.06, 0.5, 0.35), (-1.77, -0.9, z), c, 0.02)  # frames
    for y in (0.9, 1.2): cyl(0.04, 0.3, (-1.65, y, 1.7), "dark", rot=(0, 90, 0))  # coat hooks
def laundry():
    shell(floor="tile", wall="wall2")
    for x, c in ((-0.6, "white"), (0.35, "white")):
        box((0.85, 0.8, 0.9), (x, 1.45, 0.45), c, 0.08); cyl(0.28, 0.05, (x, 1.04, 0.5), "sky", rot=(90, 0, 0))
    box((2.4, 0.5, 0.06), (0.0, 1.6, 1.6), "wood")                  # shelf
    for x in (-0.8, -0.3, 0.3): box((0.3, 0.3, 0.3), (x, 1.6, 1.8), ["mint", "pink", "sun"][int((x + 0.8) / 0.55)], 0.05)
    cyl(0.4, 0.5, (0.9, -0.6, 0.25), "wood", verts=16); ball(0.32, (0.9, -0.6, 0.55), "lilac")  # basket
    box((1.1, 0.9, 0.06), (-0.8, -0.6, 0.6), "teal")                # folding table
    for dx in (-0.45, 0.45):
        for dy in (-0.35, 0.35): cyl(0.04, 0.6, (-0.8 + dx, -0.6 + dy, 0.3), "dark")
def dining_room():
    shell(wall="cream")
    box((2.2, 1.3, 0.1), (0.2, 0.0, 0.8), "wood")                    # table top
    for dx in (-0.9, 0.9):
        for dy in (-0.5, 0.5): cyl(0.05, 0.75, (0.2 + dx, dy, 0.38), "wood")
    for x in (-0.5, 0.2, 0.9):
        for y, s in ((-1.0, 1), (1.0, -1)): box((0.45, 0.45, 0.08), (x, y, 0.48), "teal"); box((0.45, 0.08, 0.5), (x, y + 0.2 * s, 0.75), "teal")
    for x in (-0.4, 0.2, 0.8): cyl(0.15, 0.03, (x, -0.3, 0.87), "white"); cyl(0.15, 0.03, (x, 0.3, 0.87), "white")
    cyl(0.03, 0.9, (0.2, 0, 2.2), "dark"); cyl(0.3, 0.25, (0.2, 0, 1.7), "sun")  # pendant lamp
def yard_and_outside():
    shell(floor="grass", walls=False)
    box((0.9, 4.0, 0.06), (-0.6, 0, 0.03), "floor", 0.02)           # path
    cyl(0.18, 1.2, (1.3, 1.3, 0.6), "wood"); ball(0.8, (1.3, 1.3, 1.6), "leaf"); ball(0.55, (1.0, 1.0, 2.0), "leaf")  # tree
    for x in (-1.9, -1.3, -0.7, -0.1, 0.5, 1.1, 1.7): box((0.12, 0.08, 0.8), (x, 1.95, 0.4), "white", 0.03)  # fence
    box((3.9, 0.06, 0.08), (0, 1.95, 0.55), "white", 0.02)
    box((0.7, 0.45, 0.35), (0.7, -0.9, 0.3), "red", 0.08)           # mower
    for dx in (-0.25, 0.25):
        for dy in (-0.2, 0.2): cyl(0.11, 0.06, (0.7 + dx, -0.9 + dy, 0.11), "dark", rot=(90, 0, 0))
    cyl(0.04, 0.6, (1.15, -0.9, 0.6), "dark", rot=(0, -45, 0))
    for x, c in ((1.6, "teal"), (1.85, "navy")): box((0.3, 0.3, 0.6), (x, -1.6, 0.3), c, 0.06)  # bins
    for p in ((-1.5, -1.2), (-1.3, 0.2)): ball(0.18, (p[0], p[1], 0.15), "pink")  # flowers
def garage():
    shell(floor="steel", wall="wall")
    box((1.6, 2.6, 0.7), (0.5, -0.3, 0.55), "sky", 0.25)             # car body
    box((1.3, 1.4, 0.5), (0.5, -0.4, 1.1), "sky", 0.2); box((1.32, 1.2, 0.35), (0.5, -0.4, 1.12), "navy", 0.12)
    for dx in (-0.75, 0.75):
        for dy in (-1.1, 0.6): cyl(0.28, 0.2, (0.5 + dx, -0.3 + dy, 0.28), "dark", rot=(0, 90, 0))
    box((0.5, 2.6, 0.05), (-1.6, 0.4, 0.9), "wood"); box((0.5, 2.6, 0.05), (-1.6, 0.4, 1.6), "wood")  # shelves
    for i, y in enumerate((-0.5, 0.2, 0.9)): box((0.4, 0.45, 0.35), (-1.6, y, 1.1), ["wood", "sun", "coral"][i], 0.04)
    box((0.6, 0.6, 0.5), (1.5, 1.4, 0.25), "wood", 0.04); box((0.5, 0.5, 0.4), (1.5, 1.4, 0.7), "wood", 0.04)
def bedroom():
    shell(wall="lilac")
    tag("bed"); box((1.5, 2.2, 0.45), (0.6, 0.6, 0.25), "wood"); box((1.45, 1.6, 0.18), (0.6, 0.35, 0.56), "sun", 0.08)
    box((1.1, 0.45, 0.18), (0.6, 1.4, 0.58), "white", 0.08); box((1.5, 0.12, 0.9), (0.6, 1.75, 0.6), "wood")
    tag("nightstand"); box((0.5, 0.45, 0.5), (-0.5, 1.5, 0.25), "teal"); cyl(0.1, 0.35, (-0.5, 1.5, 0.68), "coral"); ball(0.15, (-0.5, 1.5, 0.95), "cream")
    tag("rug"); box((1.4, 1.0, 0.03), (0.4, -0.9, 0.02), "mint", 0.01)
    tag("toys"); [box((0.25, 0.25, 0.25), (p[0], p[1], 0.13), c, 0.05) for p, c in (((-1.0, -0.8), "red"), ((-0.7, -1.2), "sky"), ((-1.2, -1.3), "sun"))]
    tag("wardrobe"); box((0.7, 0.5, 1.8), (-1.6, -0.2, 0.9), "wood")
    tag(None)
def getting_ready():
    shell(floor="tile", wall="pink")
    box((1.2, 0.6, 0.85), (0.3, 1.5, 0.42), "white", 0.08)          # sink unit
    box((0.6, 0.4, 0.07), (0.3, 1.45, 0.88), "sky", 0.03)
    box((1.0, 0.06, 0.9), (0.3, 1.77, 1.6), "sky", 0.03)            # mirror
    cyl(0.08, 0.2, (0.85, 1.45, 0.98), "mint"); cyl(0.015, 0.25, (0.85, 1.45, 1.15), "coral")  # toothbrush cup
    box((0.7, 0.55, 1.9), (-1.55, 0.2, 0.95), "wood")                # wardrobe
    box((0.06, 0.4, 0.5), (-1.2, 0.2, 1.2), "sun", 0.02)            # coat on door
    box((0.5, 0.35, 0.45), (0.9, -0.5, 0.22), "teal"); ball(0.18, (0.9, -0.5, 0.6), "lilac")  # stool + hairbrush pouf
    box((0.8, 0.6, 0.03), (0.0, 0.3, 0.02), "mint", 0.01)

ROOMS = {"kitchen": kitchen, "living-room": living_room, "main-bathroom": main_bathroom, "hallway-and-entry": hallway_and_entry,
         "laundry": laundry, "dining-room": dining_room, "yard-and-outside": yard_and_outside, "garage": garage,
         "bedroom": bedroom, "getting-ready": getting_ready}

# ---------- scene ----------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    sc = bpy.context.scene
    try: sc.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError: sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = SIZE; sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"; sc.view_settings.exposure = -0.2
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.9, 0.92, 0.95, 1); bg.inputs[1].default_value = 0.35
    cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = 6.4
    cam = bpy.data.objects.new("cam", cam_data); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (9.5, -9.5, 8.9); cam.rotation_euler = (math.radians(58), 0, math.radians(45))
    for loc, energy, rot in (((6, -4, 10), 2.6, (40, 10, 35)), ((-5, -6, 6), 0.6, (65, -20, -30))):
        ld = bpy.data.lights.new("sun", "SUN"); ld.energy = energy; ld.angle = math.radians(12)
        lo = bpy.data.objects.new("sun", ld); sc.collection.objects.link(lo); lo.location = loc; lo.rotation_euler = [math.radians(a) for a in rot]
    global ROOT
    ROOT = bpy.data.objects.new("root", None); sc.collection.objects.link(ROOT); ROOT.location = (0, 0, -0.75)
    return sc

if os.environ.get('ROOMS_LIB') != '1':
  os.makedirs(OUT, exist_ok=True)
for slug, build in (ROOMS.items() if os.environ.get('ROOMS_LIB') != '1' else []):
    if ONLY and slug not in ONLY: continue
    sc = reset(); build()
    os.makedirs(os.path.join(OUT, slug), exist_ok=True)
    for f in range(FRAMES):
        ROOT.rotation_euler = (0, 0, math.radians(-SWING + 2 * SWING * f / (FRAMES - 1)))
        sc.render.filepath = os.path.join(OUT, slug, f"{f:02d}.png")
        bpy.ops.render.render(write_still=True)
    print("ROOM DONE", slug, flush=True)
print("ALL DONE", flush=True)
