# Family Chores: per-room layers for the "colouring book" look.
#   blender.exe -b -P room_layers.py -- <out_dir> kitchen bedroom ...
# For each room (scene angle = turntable frame 05): color.png, line.png (uncoloured line art),
# mask-<item>.png (white where that chore's item is visible, black elsewhere, occlusion respected).
import bpy, math, os, sys
os.environ['ROOMS_LIB'] = '1'
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'rooms_blender.py'), encoding='utf-8').read())

argv = sys.argv[sys.argv.index('--') + 1:]
OUTDIR, SLUGS = argv[0], argv[1:]
ANGLE = -SWING + 2 * SWING * 5 / (FRAMES - 1)

def render(path):
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)

def flat(color):
    m = bpy.data.materials.new('flat'); m.use_nodes = True; nt = m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs[0].default_value = color; e.inputs[1].default_value = 1.0
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs[0]); return m

for slug in SLUGS:
    sc = reset(); ROOMS[slug](); ROOT.rotation_euler = (0, 0, math.radians(ANGLE))
    d = os.path.join(OUTDIR, slug); os.makedirs(d, exist_ok=True)
    meshes = [o for o in sc.objects if o.type == 'MESH']
    items = sorted({o.get('item') for o in meshes if o.get('item')})
    render(os.path.join(d, 'color.png'))
    # line art: everything white paper, soft light, black outlines
    paper = bpy.data.materials.new('paper'); paper.use_nodes = True
    b = next(n for n in paper.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); b.inputs['Base Color'].default_value = (0.97, 0.97, 0.96, 1); b.inputs['Roughness'].default_value = 1
    b.inputs['Emission Color'].default_value = (1, 1, 0.99, 1); b.inputs['Emission Strength'].default_value = 0.85   # flat paper, little shading
    orig = {o.name: [s.material for s in o.material_slots] for o in meshes}
    for i, o in enumerate(meshes):          # a copy per object so every object boundary gets an outline
        mp = paper.copy(); mp.name = f'paper{i}'
        for s in o.material_slots: s.material = mp
    sc.render.use_freestyle = True; sc.render.line_thickness_mode = 'ABSOLUTE'; sc.render.line_thickness = 2.2
    fs = sc.view_layers[0].freestyle_settings
    if not fs.linesets: fs.linesets.new('ink')
    for ls in fs.linesets:
        if ls.linestyle is None: ls.linestyle = bpy.data.linestyles.new('ink')
        ls.linestyle.thickness = 2.4
        ls.linestyle.color = (0.16, 0.14, 0.13); ls.select_by_visibility = True; ls.select_by_edge_types = True
        ls.select_silhouette = True; ls.select_border = True; ls.select_crease = True; ls.select_external_contour = True; ls.select_material_boundary = True
    fs.crease_angle = math.radians(150)
    render(os.path.join(d, 'line.png'))
    sc.render.use_freestyle = False
    # masks: one flat white item on flat black everything else (so other objects still hide it)
    white, black = flat((1, 1, 1, 1)), flat((0, 0, 0, 1))
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
    for it in items:
        for o in meshes:
            for s in o.material_slots: s.material = white if o.get('item') == it else black
        render(os.path.join(d, f'mask-{it}.png'))
    print('LAYERS DONE', slug, items, flush=True)
