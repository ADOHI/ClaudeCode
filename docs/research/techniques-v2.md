# 리서치 원자료: 도메인별 기법 목록 (검증 통과분)

검증자(skeptic)가 존재와 주장 정확도를 확인한 뒤 남긴 기법들입니다. 점수는 1–5 (N 자연스러움, S 과장 제어, U Unity 이식성, F 실현성(검증 후 보정)).


## authoring-deformation

The 2017 Kelvinlet field should stay as the delivery layer. It is a smooth, injectivity-checked space map applied to every clothing layer and every split seam vertex, and none of the 2022-2026 surface methods give that property. The newer work beats it at generating the target shapes, so the upgrade is a hybrid: newer methods generate the shapes on the welded body, then their displacement is distilled back into a space map before baking. Distillation means least-squares fitting the Kelvinlet brush parameters, or a Somigliana / anisotropic-Green cage. det(I+J)>0, analytic F^-T normal deltas, layer ordering and seam welding all keep working, and the Unity runtime does not change: every method here outputs static per-vertex deltas.

Ranked plan:
1. CPU, now: normal-driven dARAP from Geometry in Style (CVPR 2025). Its minimal code runs on CPU, and its lambda gives a ready-made stylization-strength knob that can be baked as in-between frames.
2. CPU, now: Jacobian/Poisson editing (NJF 2022, LJN SIGGRAPH Asia 2024, DragD3D's rotation/stretch split). It applies to our own analytic F: clamp texture stretch, make directional exaggeration, and build combination correctives.
3. Replace free brushes with an elastic cage: Somigliana coordinates (SIGGRAPH 2023, closed form in SIGGRAPH 2024), the de Goes successor to Kelvinlets. Optionally add anisotropic Green coordinates (arXiv 2025) for directional lift/spread exaggeration.
4. On the local GPU: Simplicits/VBD (SIGGRAPH 2024) for physically natural, volume-preserving gravity and pose targets.
5. On the local GPU, as suggestion generators only: diffusion-guided APAP (CVPR 2024), MeshUp (3DV 2025) and image-guided stylization (CVPR 2026). Each needs a ROI mask, a LoRA or reference built from in-house clothed renders, and artist approval.

Excluded:
- Topology-changing editors such as MagicClay (SIGGRAPH Asia 2024) and RADmesh (arXiv Aug 2026), and the Gaussian-splat drag methods (ARAP-GS, 3DGS-Drag, MVDrag3D). Their output cannot become blend shapes without re-registration.
- No Kelvinlet extension after Sharp Kelvinlets (2019) was found in graphics venues. The closest are Somigliana coordinates and Neural-Augmented Kelvinlet (AAAI 2026).

Caveats:
- arxiv.org, GitHub Pages and the ACM DL were unreachable from this container. Paper facts come from search snippets, and code facts come from the repos' raw READMEs.
- Unconfirmed: the venues of DragD3D and Anisotropic Green Coordinates, the Sharp Kelvinlets venue, and the code release status of Somigliana, Anisotropic Green Coordinates and the CVPR 2026 image-guided stylization paper.


검증 탈락: As-Plausible-As-Possible (APAP): handle-based deformation with a diffusion plausibility prior, MeshUp: multi-target, region-controlled deformation via Blended Score Distillation (successor of TextDeformer), Higher-order-continuity smooth ARAP (spike-free click-and-drag), Anisotropic Green Coordinates (directional cage deformation), Neural-Augmented Kelvinlet (Kelvinlet prior + learned FEM residual), the most recent Kelvinlet-family extension found


| 기법 | 출처 | 연도 | 위치 | N | S | U | F |
|---|---|---|---|---|---|---|---|
| Normal-driven differentiable ARAP (dARAP) stylization, from 'Geometry in Style' | [Geometry in Style: 3D Stylization via Surface Normal Deformation. Nam Anh Dinh, Itai Lang, Hyunwoo Kim, Oded Stein, Rana](https://github.com/threedle/geometry-in-style) | 2025 | bake-time (Blender/Python -> shape keys) | 4 | 5 | 5 | 3 |
| Somigliana Coordinates: elasticity-derived cage deformation (Kelvinlet-family successor), with closed form via 3D biharmonic coordinates | [Somigliana Coordinates: an elasticity-derived approach for cage deformation. Jiong Chen, Fernando de Goes, Mathieu Desbr](https://gitlab.com/jthiery/biharmonic3dcoordinates_siggraph2024) | 2023 | both | 4 | 3 | 5 | 3.5 |
| Gradient-domain (Jacobian + Poisson) editing: Neural Jacobian Fields, Local Jacobian Network (Deformation Recovery), DragD3D rotation/stretch split | [Neural Jacobian Fields: Learning Intrinsic Mappings of Arbitrary Meshes. N. Aigerman, K. Gupta, V. G. Kim, S. Chaudhuri,](https://github.com/sentient07/LJN) | 2024 | bake-time (Blender/Python -> shape keys) | 4 | 4 | 5 | 4 |
| Simplicits reduced-order elastic simulation (plus Vertex Block Descent) as a 'natural target' generator | [Simplicits: Mesh-Free, Geometry-Agnostic, Elastic Simulation. Vismay Modi, Nicholas Sharp, Or Perel, Shinjiro Sueda, Dav](https://github.com/NVIDIAGameWorks/kaolin/blob/master/docs/notes/simplicits.rst) | 2024 | both | 5 | 2 | 4 | 3 |
| Image-Guided Geometric Stylization of 3D Meshes (topology-preserving, reference-image-driven) | [Image-Guided Geometric Stylization of 3D Meshes. Changwoon Choi, Hyunsoo Lee, Clement Jambon, Yael Vinker, Young Min Kim](https://github.com/changwoonchoi/GeoStyle) | 2026 | bake-time (Blender/Python -> shape keys) | 3 | 5 | 5 | 2.5 |

## physics-bake

The current Kelvinlet-field baseline is not obsolete. Kelvinlets are still the analytic prior in 2026 work: Neural-Augmented Kelvinlet (AAAI 2026) learns an FEM-trained residual on top of them. What is outdated is using geometric brushes as the source of shape. The 2022-2026 toolset makes an offline physics bake practical, and it can be layered on top of the field instead of replacing it.

Recommended bake stack, everything offline, Unity still receives plain blend shapes:
1. **Volume:** tetrahedralize a closed bust-region volume (skin patch plus an inner fascia/rib-cage offset). Optionally take tissue layering cues from HIT (CVPR 2024), within its license.
2. **Inverse rest shape:** make the artist's stylized sculpt the in-gravity equilibrium (sag-free two-stage, SIGGRAPH 2022; STAGED, CGF 2026). This preserves the anime silhouette at default pose while every derived deformation stays physically coherent.
3. **Load cases per target:**
   - size: growth tensor F = Fe*Fg, or pressure inflation.
   - lift: gravity scale/direction, or Cooper's-ligament pre-tension.
   - spread: lateral compression collider.
   - stylized vs natural: effective gravity (the elasto-gravity ratio rho*g*L/mu), anisotropic ligament stiffness from Briot 2022 and the 2024-2026 ligament-network FE studies, and internal pressure against skin tension (the Laplace law, which pushes toward round caps).
4. **Solve to static equilibrium:** either VBD with OGC contact via Newton's SolverVBD (verified pip-installable and running on CPU in this container), or a numpy/scipy projected-Newton solver using Stable Neo-Hookean with the 2024 absolute-eigenvalue filter (built for large volume change at a Poisson ratio of about 0.495), plus ipctk barriers.
5. **Cloth:** simulate garment layers in the same solve. This adds real tension and bridging that a displacement field cannot express.
6. **Export:** per-target deltas with in-between frames and combination correctives (to handle nonlinearity), with normals from per-tet F^-T.
7. **Certify:** run ipctk intersection and distance checks over all slider extremes, replacing the field-only det(I+J) > 0 proxy for cloth.
8. **Optional runtime:**
   - Compress pose and gravity-orientation physics bakes into a few pose-driven correctives (the Unreal Neural Morph Model idea; Unity has no equivalent since Ziva was discontinued in April 2024). This upgrades the hand-written arm-raise corrective.
   - Precompute skinning eigenmodes (Fast Complementary Dynamics, 2023) to shape the jiggle springs physically.

None of these bake-time physics methods appears in public game character-customization pipelines that I could find. Most use sculpted shapes plus spring bones; I did not verify specific titles. The novelty is real, and the risk is contained because the runtime stays plain blend shapes.

Caveats:
- WebFetch could not reach arXiv, PubMed, Nature, ScienceDirect or Utah pages from this container, so details of several 2025-2026 papers come from search abstracts only.
- The authors of the Clinical Biomechanics 2026 ligament-network paper are unverified.
- I found no significant 2022-2026 successor to SoftSMPL/DMPL focused on body soft-tissue shape, and SMPL-family licenses are a commercial-use risk.

Test script: /tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/vbd_test.py (venv at /tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/venv with newton 1.7.0, warp-lang 1.18.0, ipctk 1.6.0).


| 기법 | 출처 | 연도 | 위치 | N | S | U | F |
|---|---|---|---|---|---|---|---|
| Vertex Block Descent + Offset Geometric Contact, run offline through NVIDIA Newton (SolverVBD) as the bake engine for tissue and cloth | [Chen, Liu, Yang, Yuksel, 'Vertex Block Descent', ACM TOG 43(4) (SIGGRAPH 2024). Follow-ups: Chen, Hsu, Liu, Macklin, Yan](https://arxiv.org/abs/2403.06321) | 2025 | bake-time (Blender/Python -> shape keys) | 5 | 3 | 5 | 4 |
| Inverse rest-shape / sag-free initialization: make the artist's stylized sculpt the gravity equilibrium | [Ruan, Wang, Liu, Chen, 'STAGED: Stress-Tensor Assisted Global-local-global solver for interactive Elastic shape Design',](https://diglib.eg.org/handle/10.1111/cgf70402) | 2026 | bake-time (Blender/Python -> shape keys) | 4 | 5 | 5 | 4 |
| Growth-tensor and pressure inflation (F = Fe*Fg) for size_up / size_down instead of a Kelvinlet scale brush | [Ortigosa-Martínez, Martínez-Frutos, Mora-Corral, Pedregal, Periago, 'Shape-Programming in Hyperelasticity Through Differ](https://pmc.ncbi.nlm.nih.gov/articles/PMC10960783) | 2024 | bake-time (Blender/Python -> shape keys) | 5 | 4 | 5 | 4 |
| Robust quasi-static hyperelastic solve: Stable Neo-Hookean energy plus Stabler Neo-Hookean (absolute-eigenvalue) projected Newton, or Position-Based Nonlinear Gauss-Seidel | [Chen, Liu, Levin, Zheng, Jacobson, 'Stabler Neo-Hookean Simulation: Absolute Eigenvalue Filtering for Projected Newton',](https://www.cs.columbia.edu/cg/abs-psd) | 2024 | bake-time (Blender/Python -> shape keys) | 5 | 3 | 5 | 5 |
| IPC family for guaranteed intersection-free skin and cloth layers: Codimensional IPC, ipc-toolkit (ipctk), GPU libuipc / StiffGIPC | [Li, Kaufman, Jiang, 'Codimensional Incremental Potential Contact', ACM TOG 40(4) (SIGGRAPH 2021), arXiv 2012.04457. Li e](https://pypi.org/project/ipctk/) | 2024 | bake-time (Blender/Python -> shape keys) | 4 | 2 | 5 | 5 |
| Anatomical breast FEM priors: Cooper's-ligament networks, multi-component tissue models and measured anisotropic ligament laws, used as physical stylization dials | [Briot et al., 'Experimental characterisation and modelling of breast Cooper's ligaments', Biomechanics and Modeling in M](https://www.nature.com/articles/s41598-024-83598-8) | 2026 | bake-time (Blender/Python -> shape keys) | 5 | 5 | 5 | 3 |
| Neural-Augmented Kelvinlet: keep our Kelvinlet field as the analytic prior and learn an FEM-trained residual | [Shahbazi, Pereira, ..., Miga, Simaan, Kolouri, 'Neural-Augmented Kelvinlet for Real-Time Soft Tissue Deformation Modelin](https://arxiv.org/abs/2506.08043) | 2026 | both | 4 | 4 | 4 | 4 |
| Physics bake -> pose-driven compressed morph correctives (Neural Morph Model idea; skinning-eigenmode subspaces) for Unity | [Epic Games, 'ML Deformer Framework' / 'Neural Morph Model' (Unreal Engine 5.1+ docs). Benchekroun, Zhang, Chaudhuri, Gri](https://dev.epicgames.com/documentation/en-us/unreal-engine/ml-deformer-framework-in-unreal-engine) | 2023 | both | 4 | 3 | 4 | 4 |
| Simplicits: mesh-free, geometry-agnostic reduced elasticity (no tetrahedralization of messy game meshes) | [Modi, Sharp, Perel, Sueda, Levin, 'Simplicits: Mesh-Free, Geometry-Agnostic, Elastic Simulation', ACM TOG 43(4) (SIGGRAP](https://research.nvidia.com/labs/toronto-ai/simplicits) | 2024 | bake-time (Blender/Python -> shape keys) | 3 | 3 | 5 | 2 |
| Data-driven body soft-tissue models (SoftSMPL/DMPL lineage, HIT internal tissues, PhysSkin self-supervised physics skinning) | [Santesteban, Garces, Otaduy, Casas, 'SoftSMPL: Data-driven Modeling of Nonlinear Soft-tissue Dynamics for Parametric Hum](https://hit.is.tue.mpg.de/) | 2024 | research only | 3 | 1 | 3 | 2 |

## secondary-motion

Publicly verifiable production practice for anime-style games is still bone-chain pseudo-physics. Kawaii Physics, by its maintainer's account as reported by 80.lv, is used in Wuthering Waves (a customized UE4 game) and Stellar Blade. Unity has Magica Cloth 2, VRM SpringBone, Dynamic Bone and the Animation Rigging Damped Transform. DOA Xtreme 3 used a proprietary 'Soft Engine 2.0'. I found no verifiable GDC/CEDEC/Unite talk from miHoYo (Genshin, HSR) or Shift Up on bust dynamics, so their methods are unknown.

Our bone-free blend-shape design is already unusual. The key insight from 2020-2026 research is that every reduced linear subspace is literally a set of blend shapes, and a reduced ODE gives their weights. That makes the newest real-time soft-body work fit Unity SkinnedMeshRenderer naturally:
- Skinning eigenmodes and complementary dynamics (2020, 2023)
- Subspace mixed FEM (2023)
- Spring-decomposed skinning (2025)
- Learned latent integrators (2025)

Recommended upgrade of today's 1-DOF lift spring:
1. Bake 4-8 rig-complementary skinning-eigenmode shapes per side, mass-orthogonalized against the user sliders and evaluated as fields on all clothing layers, which keeps the no-interpenetration guarantee.
2. Add quadratic corrective shapes distilled from a nonlinear modal fit (Neural Modes / Simplicits), so exaggerated amplitudes stay volume-preserving instead of ballooning.
3. At runtime, integrate the reduced ODE in the chest frame with exact analytic spring steps (Jin et al. 2022), so it stays stable through mobile frame drops. Fit the parameters to offline VBD or Kaolin sims on the user's GPU.
4. Layer Velocity/Acceleration Skinning, linearized into about 9-12 stylization shapes driven by the jiggle state, for the anime controls: squash and stretch, follow-through, centrifugal stretch, overshoot.
5. Optionally add Dynamic-Kelvinlet impulse clips for landings and hits.
6. Later, train a tiny latent neural integrator (Burst job) for amplitude-dependent stiffening and L/R coupling.

Mobile cost is dominated by the GPU blend-shape pass, about 20-30 sparse shapes over a few thousand bust-window vertices. The CPU side is microseconds. Ziva Real-Time, Unity's own ML deformation product, was discontinued in April 2024, so neural parts must be custom (Burst MLP or the Unity Inference Engine).

Caveat: in this container only search summaries were reachable (arXiv, EG DL, DGP and Pixar pages could not be fetched directly), so code-availability notes marked 'not verified' should be checked.


검증 탈락: Self-supervised latent-space neural integrator over blend-shape weights (mobile-oriented subspace dynamics), Dynamic Kelvinlets as event-triggered impulse-response clips (landing, dodge, hit) superposed on the modal jiggle, SMEAR: art-directed motion-offset exaggeration (smears, trailing, motion lines) for authored or cutscene animation


| 기법 | 출처 | 연도 | 위치 | N | S | U | F |
|---|---|---|---|---|---|---|---|
| Rig-complementary skinning-eigenmode subspace baked as modal jiggle blend shapes (Fast Complementary Dynamics + Subspace Mixed-FEM) | [Benchekroun, Zhang, Chaudhuri, Grinspun, Zhou, Jacobson, 'Fast Complementary Dynamics via Skinning Eigenmodes', ACM TOG ](https://github.com/otmanon/simkit) | 2023 | both | 4 | 4 | 5 | 4 |
| Velocity Skinning + Acceleration Skinning, linearized into a blend-shape stylization basis | [Rohmer, Tarini, Kalyanasundaram, Moshfeghifar, Cani, Zordan, 'Velocity Skinning for Real-time Stylized Skeletal Animatio](https://arxiv.org/abs/2104.04934) | 2021 | both | 3 | 5 | 5 | 5 |
| Analytically integrated zero-restlength springs on top of quasistatic shapes (dynamic layer with exact, unconditionally stable integration) | [Yongxu Jin, Yushan Han, Zhenglin Geng, Joseph Teran, Ronald Fedkiw, 'Analytically Integratable Zero-restlength Springs f](https://arxiv.org/abs/2201.10122) | 2022 | both | 4 | 4 | 5 | 5 |
| Nonlinear modal subspaces (Neural Modes) distilled into linear modes plus quadratic corrective blend shapes for exaggerated amplitudes | [Jiahong Wang, Yinwei Du, Stelian Coros, Bernhard Thomaszewski, 'Neural Modes: Self-supervised Learning of Nonlinear Moda](https://github.com/NVIDIAGameWorks/kaolin) | 2024 | bake-time (Blender/Python -> shape keys) | 5 | 4 | 4 | 3 |
| Spring Decomposed Skinning and the production spring-bone landscape (Kawaii Physics, Magica Cloth 2, VRM SpringBone, Dynamic Bone, Animation Rigging), mapped to bone-free handle blend shapes | [Bartu Akyurek, Yusuf Sahillioglu, 'Real-Time Secondary Animation with Spring Decomposed Skinning', Computer Graphics For](https://github.com/pafuhana1213/KawaiiPhysics) | 2025 | runtime (Unity) | 3 | 4 | 5 | 5 |
| Learned dynamic blendshapes / ML-Deformer-style morph compression (pose + motion history -> blend-shape weights) | [Santesteban, Garces, Otaduy, Casas, 'SoftSMPL: Data-driven Modeling of Nonlinear Soft-tissue Dynamics for Parametric Hum](https://arxiv.org/abs/2004.00326) | 2020 | both | 4 | 2 | 4 | 3 |
| Vertex Block Descent as offline ground-truth generator (and optional PC/console runtime solver) for fitting and training the blend-shape dynamics | [Anka He Chen, Ziheng Liu, Yin Yang, Cem Yuksel, 'Vertex Block Descent', ACM TOG 43(4) (SIGGRAPH 2024), arXiv 2403.06321.](https://github.com/AnkaChan/Gaia) | 2024 | bake-time (Blender/Python -> shape keys) | 5 | 2 | 2 | 3 |

## garments

I found ten techniques and ranked them best first. My recommendation is to keep the warp but stop using it as the final answer for every garment.

**Where one injective warp is not enough.** The single warp is right for skin-tight layers (bra, bodysuit, painted-on anime tops). It also gives a guaranteed intersection-free starting state, which is exactly what modern barrier methods need. It fails in five cases:
1. **Fabric across the cleavage.** The midline lock keeps it in the cleavage, giving a painted-on look instead of a taut bridge between the two apexes.
2. **Loose tops and coats.** They inflate in a breast shape instead of hanging from the apex, and the front hem should rise and move forward. That is outside our compact window.
3. **Straps and hems.** The warp moves points with the body surface, so a strap cannot slide sideways or keep its length.
4. **Fitted garments.** Fabric is stretched where a real garment would have more fabric.
5. **Slider combinations and in-between weights.** The response is not linear.

**What 2023–2026 work adds.** The newer methods share three ideas:
- **Guarantees:** IPC barriers (Intersection-Free Garment Retargeting, SIGGRAPH 2025) and Offset Geometric Contact with Vertex Block Descent (SIGGRAPH 2024/2025).
- **Design preservation:** strain energy measured against the authored garment, plus per-region tightness (Pixar's 2020 idea).
- **Pattern awareness:** Dress Anyone, Digital Garment Alteration, GarmentCode, and NVIDIA's Bolt, which transfers fabric strain.

Neural simulators (HOOD, ContourCraft) are fast on a GPU but give no guarantee.

**Recommended bake pipeline, one shape key per garment with the same name as the body key:**
- **Step 0:** the Kelvinlet warp, as both initializer and safety baseline.
- **Tight layers:** the warp, plus Epic's confidence-masked transfer with Laplacian inpainting (SIGGRAPH Asia 2023) to fix cleavage bridging. This is the cheapest step, has existing code, and works on CPU today.
- **Fitted layers with bridging or straps:** a warp-initialized IPC refit with a tightness map. Use ipctk on CPU and treat the inner layers as obstacles.
- **Loose tops, skirts and coats:** a penetration-free cloth drape in Newton's VBD solver as the body morphs. Store the target result minus the basis result, so weight 0 stays exactly the authored mesh. Bake a "hug" and a "taut" variant and mix them with a fabric-tension slider for stylized control.

**Checks and runtime:** Check every key at weights 0.25, 0.5, 0.75 and 1. Add Unity in-between frames through an AssetPostprocessor, because Blender's FBX exporter can't write them. Add combination correctives for size × lift. If needed, add a low-strength body-SDF push-out at runtime (Unity's Mesh-to-SDF package). Before copying cage-based conforming, do a patent check (Roblox) and verify that runtime cloth works with blend-shape-deformed vertices.

**Limits of what I could verify.** arXiv, cims.nyu.edu, graphics.cs.utah.edu and docs.blender.org were blocked from this container. For those sources I used search summaries, and the details still need checking against the papers:
- the exact energies in the 2025 retargeting paper;
- Bolt's Stokes and warp/weft steps (the only source is an AI-generated review);
- LoBoFit, PhySkin and HyperBones, where I saw abstracts only.

I found no official code for the retargeting paper, Bolt, LoBoFit, PhySkin or HyperBones. Code does exist for:
- Newton, Apache-2.0, on PyPI with a CPU option;
- ipctk, on PyPI;
- RobustSkinWeightsTransferCode;
- HOOD and ContourCraft, MIT, CUDA required;
- GarmentCode;
- Unity Mesh-to-SDF.


검증 탈락: Body-driven field extrapolation + strain-preserving pattern adjustment + drape/untangle (Bolt pipeline), Local-frame garment refitting (LoBoFit: Local Bone Mapping Blending)


| 기법 | 출처 | 연도 | 위치 | N | S | U | F |
|---|---|---|---|---|---|---|---|
| Warp-initialized, IPC-barrier design-preserving garment refit (morph-through optimization) | [Zizhou Huang, Chrystiano Araújo, Andrew Kunz, Denis Zorin, Daniele Panozzo, Victor Zordan. 'Intersection-Free Garment Re](https://doi.org/10.1145/3721238.3730590) | 2025 | bake-time (Blender/Python -> shape keys) | 4 | 4 | 5 | 3 |
| Penetration-free cloth 'morph-through' drape bake: Vertex Block Descent + Offset Geometric Contact (Newton SolverVBD) | [Anka He Chen, Ziheng Liu, Yin Yang, Cem Yuksel. 'Vertex Block Descent'. ACM TOG 43(4), SIGGRAPH 2024. Anka He Chen, Jerr](https://doi.org/10.1145/3731205) | 2025 | bake-time (Blender/Python -> shape keys) | 5 | 3 | 5 | 3 |
| Confidence-masked body-to-garment delta transfer with Laplacian inpainting | [Rinat Abdrashitov, Kim Raichstat, Jared Monsen, David Hill (Epic Games). 'Robust Skin Weights Transfer via Weight Inpain](https://github.com/rin-23/RobustSkinWeightsTransferCode) | 2023 | bake-time (Blender/Python -> shape keys) | 3 | 3 | 5 | 4 |
| Sewing-pattern / rest-shape regrading for 'natural' fit (GarmentCode, Dress Anyone, Digital Garment Alteration) | [Maria Korosteleva, Olga Sorkine-Hornung. 'GarmentCode: Programming Parametric Sewing Patterns'. ACM TOG 42(6), Dec 2023 ](https://github.com/maria-korosteleva/GarmentCode) | 2025 | bake-time (Blender/Python -> shape keys) | 5 | 2 | 5 | 2 |
| Neural garment simulators as bake-time drapers and untanglers (HOOD, ContourCraft) | [Artur Grigorev, Bernhard Thomaszewski, Michael J. Black, Otmar Hilliges. 'HOOD: Hierarchical Graphs for Generalized Mode](https://github.com/dolorousrtur/ContourCraft) | 2024 | bake-time (Blender/Python -> shape keys) | 4 | 2 | 5 | 2 |
| Blender-native baseline: Surface Deform -> Cloth (Dynamic Mesh, Shrinking) -> 'Save as Shape Key' + Geometry-Nodes obstacle-constrained relaxation | [Blender Manual: Surface Deform, Mesh Deform, Shrinkwrap (Outside/Above Surface + Offset), Data Transfer, Cloth > Shape (](https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/surface_deform.html) | 2023 | bake-time (Blender/Python -> shape keys) | 3 | 4 | 5 | 5 |
| Unity runtime contact guard: real-time body SDF (Mesh-to-SDF) + garment push-out, in-between frames and combination correctives | [Unity Technologies Demo Team, 'Mesh-to-SDF' package (com.unity.demoteam.mesh-to-sdf, Unity 2021.2+, compute shaders). Un](https://github.com/Unity-Technologies/com.unity.demoteam.mesh-to-sdf) | 2023 | runtime (Unity) | 3 | 3 | 4 | 3.5 |
| Bone-driven neural quasi-static garment response for runtime (PhySkin / HyperBones) | [Astitva Srivastava et al. (IIIT Hyderabad, Meta Reality Labs). 'PhySkin: Physics-based Bone-driven Neural Garment Simula](https://github.com/facebookresearch/physkin) | 2026 | research only | 3 | 2 | 3 | 2 |

## appeal-optimization

The 2017 Regularized Kelvinlet field is not the outdated part. Keep it as the student representation, because it is the only thing in the pipeline that guarantees cloth layers never interpenetrate, seams never open and det(I+J)>0, and it bakes straight to Unity blend shapes. What is outdated is how its ~20 parameters are chosen: today that is by hand. The 2022-2026 methods belong in a bake-time teacher/critic loop that only chooses theta. Neural deformers (APAP 2024, Geometry in Style 2025, MeshUp 2024/25) are used as teachers and then distilled into Kelvinlet parameters. Nothing new runs inside Unity, so runtime cost and portability stay the same.

PROPOSED LOOP (per one-sided target, e.g. bust_size_up_stylized; theta = scale brush at/k/radius/nu + grab brush at/d/radius/nu + window yUp/yDown/hardness, about 14-20 dimensions with bounds):
(0) Gate, CPU, ms: bake on body plus all cloth layers at w = {0.5, 1}, and stacked with lift ±1 and spread ±1. Reject if det(I+J)<=0, layer order is violated, or the minimum cloth gap is too small (port validate.js).
(1) Morphometrics M(theta), CPU, ms: UP:LP ratio, apex tilt, upper-pole concavity/convexity, lower-pole convexity, fold height (sag), projection/base width, profile-curve turning (silhouette clarity), lateral divergence. Natural band = Mallucci 45:55 and about 20 degrees upward tilt. Stylized band = my proposed anime offsets (about 50:50, 25-30 degrees, slightly convex upper pole, higher fold). These offsets are hypotheses to be confirmed by human preference.
(2) Naturalness N(theta), CPU: residual outside the span of the Anny/MakeHuman CC0 breast modes once fitted into our brush space, plus Mahalanobis distance of the mode coefficients, calibrated on RBSM if its license allows.
(3) Appeal A(theta): fixed toon-shaded, outlined, CLOTHED contact sheet (front, 3/4 L/R, profile, silhouette mask, 2 poses, 768-1024 px). Render with Blender Workbench/EEVEE headless or the three.js prototype. Score the change against the baseline using anime_dbaesthetic (ONNX, CPU OK) plus ImageReward/PickScore/HPSv2 with natural-vs-stylized prompt contrast.
(4) Optimizer: multi-objective search, maximizing A and minimizing N under M-band penalties. Options: MO-CMA-ES, Optuna NSGA-II, or scalarized CMA-ES at several lambdas (cmaes/pycma), popsize 12-16, about 500-1000 evaluations. About 2-3 h on CPU at about 10 s per evaluation, or minutes on a GPU.
(5) The Pareto front becomes the style slider. Its natural end (lowest N with A >= baseline) becomes size_up_natural; its stylized end (highest A with N <= tau and inside the anime M-band) becomes size_up_stylized. Check that the linear blend at style = 0.5 stays near the front; if not, add an in-between blend-shape frame.
(6) Top-K go to a VLM pairwise tournament (GPTEval3D-style rubric, through an API or a local VLM).
(7) The final 10-20 go to the art director: Optuna Dashboard PreferentialStudy (skew-GP PBO, Takeno 2023) or Sequential Gallery, about 20-40 clicks. The learned utility re-weights the critic lambdas for the next run.

GPU needs: only SDS-based teachers (APAP, TADA-style SDS on theta, Geometry in Style text mode, MeshUp; 16-24 GB+), a local VLM judge, and fast nvdiffrast rendering. Everything else runs on CPU today in this container: bake, gates, morphometrics, the Anny prior, CMA-ES, ONNX anime aesthetic scoring, slow ImageReward, Blender Workbench renders, PBO/BOPE.

SFW/ethics: score clothed renders only, keep parameter bounds and the naturalness term so learned critics cannot drift toward extreme shapes, and use only adult anchors in Anny.

Verification notes: the WebSearch budget ran out after 4 searches, and arXiv, ACM, CVF, PubMed, Hugging Face and the project pages could not be reached from this container. I verified the following online or by reading the packages: Geometry in Style (CVPR 2025), APAP (CVPR 2024), MeshUp (arXiv 2408.14899), RBSM (Visual Computer 2022/23), Anny (PyPI 0.6.1 README/bibtex, ECCV 2026), optuna-dashboard PreferentialGPSampler citing Takeno et al. arXiv 2302.01513, deepghs anime_aesthetic in dghs-imgutils, and the PyPI packages image-reward, hpsv2, cmaes, cma and botorch. All other citations (Koyama 2017/2020, Mallucci 2012/2014 and the DOI, BOPE, ImageReward/PickScore/Q-Align venues, GPTEval3D, BlenderAlchemy, TADA, Cubic Stylization, Sela 2015, 3DCaricShop and its URL, DeformToon3D) come from memory and should be spot-checked. A follow-up message can resume web verification. Prototype files I read: /home/user/ClaudeCode/web/src/core/field.js and /home/user/ClaudeCode/web/src/core/autofit.js. Downloaded package sources for inspection are in /tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/anny_dl and /tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/pkgs.


검증 탈락: Diffusion-prior plausibility on deformations: APAP (Jacobians, Poisson solve, SDS with a LoRA-personalized model), plus TADA-style SDS on low-dimensional shape parameters, Multi-target, region-limited deformation with Blended Score Distillation (MeshUp) to generate a whole natural-to-stylized family, Curvature-driven caricaturization and EDFM 3D caricature (Sela-Aflalo-Kimmel gradient scaling; 2021-2023 learned 3D caricature)


| 기법 | 출처 | 연도 | 위치 | N | S | U | F |
|---|---|---|---|---|---|---|---|
| Statistical naturalness prior from Anny (MakeHuman CC0 breast modifiers) plus the RBSM breast-scan model, with exaggeration along natural modes (EDFM in brush-parameter space) | [Bregier, Fiche, Bravo-Sanchez, Lucas, Armando, Weinzaepfel, Rogez, Baradel. 'Human Mesh Modeling for Anny Body', ECCV 20](https://github.com/naver/anny) | 2025 | bake-time (Blender/Python -> shape keys) | 4 | 3 | 5 | 4 |
| Preferential Bayesian optimization (skew-GP PBO) through Optuna Dashboard, and Koyama's Sequential Gallery / Sequential Line Search for art-director-in-the-loop tuning | [Takeno, Nomura, Karasuyama. 'Towards Practical Preferential Bayesian Optimization with Skew Gaussian Processes', ICML 20](https://github.com/optuna/optuna-dashboard/blob/main/optuna_dashboard/preferential/samplers/gp.py) | 2023 | bake-time (Blender/Python -> shape keys) | 4 | 5 | 5 | 4.5 |
| Aesthetic-surgery morphometrics as analytic objectives (Mallucci-Branford ICE ratios), with anime offsets and preference exploration over those outcomes (BOPE) | [Mallucci and Branford. 'Concepts in aesthetic breast dimensions: analysis of the ideal breast', J Plast Reconstr Aesthet](https://github.com/pytorch/botorch/blob/main/tutorials/bope/bope.ipynb) | 2012 | bake-time (Blender/Python -> shape keys) | 4 | 4 | 5 | 4.5 |
| Learned 2D aesthetic and preference critics (anime-specific aesthetic classifier, ImageReward, PickScore, HPSv2, Q-Align) driving CMA-ES over the brush parameters | [deepghs 'anime_aesthetic' (SwinV2 classifier on Danbooru-derived quality labels, exposed as imgutils.metrics.anime_dbaes](https://github.com/deepghs/imgutils/blob/main/imgutils/metrics/dbaesthetic.py) | 2023 | bake-time (Blender/Python -> shape keys) | 3 | 3 | 5 | 3 |
| VLM-as-a-judge: pairwise multi-view tournament with a rubric (GPTEval3D), and VLM-in-the-loop program editing (BlenderAlchemy) | [Wu, Yang, Li, Zhang, Liu, Guibas, Lin, Wetzstein. 'GPT-4V(ision) is a Human-Aligned Evaluator for Text-to-3D Generation'](https://github.com/ianhuang0630/BlenderAlchemyOfficial) | 2024 | bake-time (Blender/Python -> shape keys) | 3 | 4 | 5 | 4 |
| Normal-driven stylization with a differentiable ARAP layer (Geometry in Style), and its non-neural ancestors (Cubic Stylization, Normal-Driven Spherical Shape Analogies) | [Dinh, Lang, Kim, Stein, Hanocka. 'Geometry in Style: 3D Stylization via Surface Normal Deformation', CVPR 2025, pp. 2845](https://github.com/threedle/geometry-in-style) | 2025 | bake-time (Blender/Python -> shape keys) | 3 | 4 | 5 | 3 |

## pipeline

The biggest pipeline finding (verified in source code): our analytic F^-T normal deltas cannot reach Unity through Blender plus FBX.
- Blender shape keys store positions only.
- The FBX exporter writes shape normals as deltas of normals_vertex_get(): smooth vertex normals that ignore custom and sharp normals.
- Vertex-group-masked keys export unmasked deltas, with the group weights misplaced into FullWeights.
- FBX from Blender has no in-betweens.
- Unity's inspector resets 'Blend Shape Normals' to Calculate whenever the Normals mode changes.
- By contrast, the glTF exporter rebuilds morph normals from custom split normals (normals_split_get). glTFast imports normal and tangent deltas; UniVRM imports normal deltas only.
- USD is not viable today: the Blender USD exporter writes offsets only, and the Unity USD package's code shows no blend-shape import.

Recommended workflow:

**Blender (preview and positions):**
- Bake with NumPy foreach_set; keys relative to Basis; value 0 at export.
- Put the skin-weight mask into the deltas; never use vertex_group.
- Get toon custom normals via Data Transfer (NonGeometrical, so it can be applied even after keys exist). Normal Edit and Weighted Normal cannot be applied once keys exist.
- FBX: Smoothing 'Normals Only', Apply Transform, deform bones only.

**Unity (source of truth):**
- Port field.js to C#. In an AssetPostprocessor, force Import BlendShapes on, Deform Percent off, Legacy Blend Shape Normals off, Normals = Import, Blend Shape Normals = Import, Mesh Compression off, and Tangents = Import if the outline normal lives in tangents.
- In OnPostprocessModel, re-evaluate the field per imported vertex for every layer: ClearBlendShapes, then AddBlendShapeFrame with deltaNormals = normalize(F^-T n_custom) - n_custom and deltaTangents for the outline normal. The field is position-only, so seams and layer order stay intact without index mapping.
- Add procedural in-between frames (curved, stylized growth paths and controlled overdrive) and product-driven combination correctives. Blender, FBX and glTF cannot author these.
- Runtime: Mesh Deformation = GPU (Batched); Clamp BlendShapes off but clamp weights in your own driver code; bounds margin; skinned motion vectors. The C2 window keeps shapes sparse, so the cost of a ~50k-vertex character is dominated by skinning, not by the bust shapes (estimate; profile on device).

Newer, rarely shipped options to prototype next:
- Evaluating the closed-form field live on the GPU (a compute pass before skinning) so jiggle moves the Kelvinlet brushes themselves, with stylized dynamics in the spirit of Velocity Skinning (EG 2021).
- Learned correctives conditioned on pose and sliders (Neural Blend Shapes 2021, UE5 ML Deformer pattern), run as K corrective shapes plus a tiny C# MLP.
- Compressed Skinning (SIGGRAPH 2024) to turn an exploding shape count into sparse helper bones, at the cost of exact normals.

Research caveat: the shared WebSearch budget ran out and the egress proxy blocked docs.unity3d.com, blender.org, developer.blender.org and arxiv.org. Engine and exporter facts were therefore checked against primary source code on GitHub (UnityCsReference, blender/blender, UniVRM, glTFast, usd-unity-sdk, compskin, neural-blend-shapes). Three items are marked unverified in the entries: Unity skipping zero-weight shapes, how Unity interprets per-vertex FullWeights, and the UE ML Deformer doc URL.


검증 탈락: Compressed Skinning: convert a growing blend-shape set into sparse helper-bone LBS, OpenUSD UsdSkel BlendShape interchange (Blender USD exporter to the Unity USD package): investigated, not recommended


| 기법 | 출처 | 연도 | 위치 | N | S | U | F |
|---|---|---|---|---|---|---|---|
| Re-bake the blend shapes in Unity at import time: an AssetPostprocessor writes the analytic normal and tangent deltas with Mesh.AddBlendShapeFrame | [Unity 6 APIs, checked against the Unity-Technologies/UnityCsReference source (Mesh.bindings.cs, ModelImporter.bindings.c](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Modules/AssetPipelineEditor/ImportSettings/ModelImporterModelEditor.cs) | 2025 | both | 4 | 4 | 5 | 4 |
| Blender 4.x/5.x shape-key bake (bpy + NumPy foreach_set, optional Geometry Nodes preview) with the FBX exporter's constraints understood | [Blender source, blender/blender main:
- rna_key.cc: ShapeKey.select, lock_shape, slider_min/max range -10..10, vertex_gr](https://github.com/blender/blender/blob/main/scripts/addons_core/io_scene_fbx/export_fbx_bin.py) | 2025 | bake-time (Blender/Python -> shape keys) | 3 | 4 | 4 | 5 |
| Procedural in-between frames and combination correctives baked from the exactly composed field | [Unity Mesh.AddBlendShapeFrame multi-frame blend shapes: frames at increasing frameWeight, interpolated piecewise-linearl](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Graphics/Mesh.bindings.cs) | 2014 | both | 4 | 5 | 5 | 4 |
| Evaluate the closed-form field live on the GPU in Unity (compute shader before skinning, or vertex shader in chest space), with stylized dynamics in the style of Velocity Skinning | [Unity Mesh.vertexBufferTarget / Mesh.GetVertexBuffer and SkinnedMeshRenderer.GetVertexBuffer/GetPreviousVertexBuffer (Un](https://github.com/drohmer/velocity_skinning_replicability) | 2021 | runtime (Unity) | 4 | 5 | 3 | 2.5 |
| Unity 6 runtime blend-shape path and mobile cost model: GPU / GPU (Batched) mesh deformation, sparse per-shape buffers, GetBlendShapeBuffer, Entities Graphics deformations | [UnityCsReference:
- PlayerSettings.meshDeformation {CPU, GPU, GPUBatched}. Inspector tooltip: 'Calculate mesh skinning a](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Editor/Mono/PlayerSettings.bindings.cs) | 2024 | runtime (Unity) | 3 | 3 | 5 | 5 |
| glTF 2.0 morph targets (POSITION/NORMAL/TANGENT, sparse accessors) from the Blender glTF exporter into Unity via glTFast or UniVRM (VRM 1.0) | [Khronos glTF 2.0 specification, morph targets.

Blender io_scene_gltf2 options: 'Shape Key Normals' (export_morph_normal](https://github.com/blender/blender/blob/main/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py) | 2024 | both | 4 | 3 | 4 | 4 |
| Learned pose- and shape-conditioned correctives: the Neural Blend Shapes / UE5 ML Deformer 'Neural Morph Model' pattern, reduced to corrective blend shapes plus a tiny MLP evaluated in Unity | [Peizhuo Li, Kfir Aberman, Rana Hanocka, Libin Liu, Olga Sorkine-Hornung, Baoquan Chen, 'Learning Skeletal Articulations ](https://github.com/PeizhuoLi/neural-blend-shapes) | 2021 | both | 5 | 2 | 4 | 2 |
