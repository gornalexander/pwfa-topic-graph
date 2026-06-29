// Paper database for the PWFA research landscape graph.
// Key format: Journal.Volume.PageOrArticleId. Fields: title, ref, authors, doi, arxiv, me.

const papers = {
  "NaturePhys.5.363": {
    "title": "Proton-driven plasma wakefield acceleration: a path to the future of high-energy particle physics",
    "ref": "Caldwell et al., Nature Phys. 5, 363 (2009)",
    "authors": "Caldwell, Lotov, Pukhov, Simon",
    "doi": "10.1038/nphys1248",
    "arxiv": "0807.4599",
    "me": null
  },
  "NIMA.829.3": {
    "title": "Path to AWAKE: Evolution of the concept",
    "ref": "Caldwell et al., NIMA 829, 3 (2016)",
    "authors": "Caldwell, Lotov, Pukhov, Xia, AWAKE Collaboration",
    "doi": "10.1016/j.nima.2015.12.050",
    "arxiv": "1511.09032",
    "me": "coauthor"
  },
  "NIMA.829.76": {
    "title": "AWAKE, The Advanced Proton Driven Plasma Wakefield Acceleration Experiment at CERN",
    "ref": "Gschwendtner et al., NIMA 829, 76 (2016)",
    "authors": "Gschwendtner, Muggli, Caldwell, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1016/j.nima.2016.02.026",
    "arxiv": "1512.05498",
    "me": "coauthor"
  },
  "PPCF.60.014046": {
    "title": "AWAKE readiness for the study of the seeded self-modulation of a 400 GeV proton bunch",
    "ref": "Muggli et al., PPCF 60, 014046 (2018)",
    "authors": "Muggli, Gschwendtner, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1088/1361-6587/aa941c",
    "arxiv": "1708.01087",
    "me": "coauthor"
  },
  "Symmetry.14.1680": {
    "title": "The AWAKE Run 2 Programme and Beyond",
    "ref": "Gschwendtner et al., Symmetry 14, 1680 (2022)",
    "authors": "Gschwendtner, Gorn, AWAKE Collaboration",
    "doi": "10.3390/sym14081680",
    "arxiv": "2206.06040",
    "me": "coauthor"
  },
  "NIMA.829.350": {
    "title": "LCODE: A parallel quasistatic code for computationally heavy problems of plasma wakefield acceleration",
    "ref": "Sosedkin & Lotov, NIMA 829, 350 (2016)",
    "authors": "Sosedkin, Lotov",
    "doi": "10.1016/j.nima.2015.12.032",
    "arxiv": "1511.04193",
    "me": null
  },
  "PRSTAB.13.041301": {
    "title": "Simulation of proton driven plasma wakefield acceleration",
    "ref": "Lotov, PRSTAB 13, 041301 (2010)",
    "authors": "Lotov",
    "doi": "10.1103/PhysRevSTAB.13.041301",
    "arxiv": null,
    "me": null
  },
  "PRL.104.255003": {
    "title": "Self-modulation instability of a long proton bunch in plasmas",
    "ref": "Kumar, Pukhov, Lotov, PRL 104, 255003 (2010)",
    "authors": "Kumar, Pukhov, Lotov",
    "doi": "10.1103/PhysRevLett.104.255003",
    "arxiv": "1003.5816",
    "me": null
  },
  "PoP.22.103110": {
    "title": "Physics of beam self-modulation in plasma wakefield accelerators",
    "ref": "Lotov, Phys. Plasmas 22, 103110 (2015)",
    "authors": "Lotov",
    "doi": "10.1063/1.4933129",
    "arxiv": "1503.05104",
    "me": null
  },
  "PoP.18.024501": {
    "title": "Controlled self-modulation of high energy beams in a plasma",
    "ref": "Lotov, Phys. Plasmas 18, 024501 (2011)",
    "authors": "Lotov",
    "doi": "10.1063/1.3558697",
    "arxiv": null,
    "me": null
  },
  "PRL.126.164802": {
    "title": "Transition between Instability and Seeded Self-Modulation of a Relativistic Particle Bunch in Plasma",
    "ref": "Batsch et al. (AWAKE), PRL 126, 164802 (2021)",
    "authors": "Batsch, Muggli, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1103/PhysRevLett.126.164802",
    "arxiv": "2012.09676",
    "me": "coauthor"
  },
  "PRL.129.024802": {
    "title": "Controlled Growth of the Self-Modulation of a Relativistic Proton Bunch in Plasma",
    "ref": "Verra et al. (AWAKE), PRL 129, 024802 (2022)",
    "authors": "Verra, Muggli, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1103/PhysRevLett.129.024802",
    "arxiv": "2203.13752",
    "me": "coauthor"
  },
  "PRL.125.264801": {
    "title": "Proton Bunch Self-Modulation in Plasma with Density Gradient",
    "ref": "Braunmüller et al. (AWAKE), PRL 125, 264801 (2020)",
    "authors": "Braunmüller, Muggli, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1103/PhysRevLett.125.264801",
    "arxiv": "2007.14894",
    "me": "coauthor"
  },
  "Nature.561.363": {
    "title": "Acceleration of electrons in the plasma wakefield of a proton bunch",
    "ref": "Adli et al. (AWAKE), Nature 561, 363 (2018)",
    "authors": "Adli, Gschwendtner, Muggli, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1038/s41586-018-0485-4",
    "arxiv": "1808.09759",
    "me": "coauthor"
  },
  "PoP.21.123116": {
    "title": "Electron trapping and acceleration by the plasma wakefield of a self-modulating proton beam",
    "ref": "Lotov, Sosedkin, Petrenko et al., Phys. Plasmas 21, 123116 (2014)",
    "authors": "Lotov, Sosedkin, Petrenko",
    "doi": "10.1063/1.4904365",
    "arxiv": "1408.4448",
    "me": null
  },
  "JPlasmPhys.78.455": {
    "title": "Optimum angle for side injection of electrons into linear plasma wakefields",
    "ref": "Lotov, J. Plasma Phys. 78, 455 (2012)",
    "authors": "Lotov",
    "doi": "10.1017/S0022377812000335",
    "arxiv": "1109.6081",
    "me": null
  },
  "IPAC2014.TUPME078": {
    "title": "Electron Injection Studies for the AWAKE Experiment at CERN",
    "ref": "Petrenko et al., Proc. IPAC 2014",
    "authors": "Petrenko, Bracco, Gschwendtner, Lotov, Muggli",
    "doi": "10.18429/JACoW-IPAC2014-TUPME078",
    "arxiv": null,
    "me": null
  },
  "PRAB.24.011301": {
    "title": "Experimental study of extended timescale dynamics of a plasma wakefield driven by a self-modulated proton bunch",
    "ref": "Chappell et al., PRAB 24, 011301 (2021)",
    "authors": "Chappell, Muggli, Gorn, AWAKE Collaboration",
    "doi": "10.1103/PhysRevAccelBeams.24.011301",
    "arxiv": "2010.05715",
    "me": "coauthor"
  },
  "PRAB.20.101301": {
    "title": "High-quality electron beam generation in a proton-driven hollow plasma wakefield accelerator",
    "ref": "Li et al., PRAB 20, 101301 (2017)",
    "authors": "Li, Xia, Lotov, Sosedkin, Hanahoe, Mete-Apsimon",
    "doi": "10.1103/PhysRevAccelBeams.20.101301",
    "arxiv": "1610.08734",
    "me": null
  },
  "PPCF.62.125023": {
    "title": "Proton beam defocusing in AWAKE: comparison of simulations and measurements",
    "ref": "Gorn et al., PPCF 62, 125023 (2020)",
    "authors": "Gorn, Lotov, Tuev, AWAKE Collaboration",
    "doi": "10.1088/1361-6587/abb2b4",
    "arxiv": "2008.11392",
    "me": "first"
  },
  "PRL.122.054801": {
    "title": "Experimental Observation of Plasma Wakefield Growth Driven by the Seeded Self-Modulation of a Proton Bunch",
    "ref": "Turner et al., PRL 122, 054801 (2019)",
    "authors": "Turner, Muggli, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1103/PhysRevLett.122.054801",
    "arxiv": "1809.01191",
    "me": "coauthor"
  },
  "PRAB.23.081302": {
    "title": "Experimental study of wakefields driven by a self-modulating proton bunch in plasma",
    "ref": "Turner et al., PRAB 23, 081302 (2020)",
    "authors": "Turner, Muggli, Lotov, Gorn, AWAKE Collaboration",
    "doi": "10.1103/PhysRevAccelBeams.23.081302",
    "arxiv": "2005.05277",
    "me": "coauthor"
  },
  "JINST.16.P11031": {
    "title": "Analysis of proton bunch parameters in the AWAKE experiment",
    "ref": "Hafych et al., JINST 16, P11031 (2021)",
    "authors": "Hafych, Muggli, Gorn, AWAKE Collaboration",
    "doi": "10.1088/1748-0221/16/11/P11031",
    "arxiv": "2109.12893",
    "me": "coauthor"
  },
  "NIMA.829.63": {
    "title": "Numerical studies of electron acceleration behind self-modulating proton beam in plasma with a density gradient",
    "ref": "Petrenko, Lotov, Sosedkin, NIMA 829, 63 (2016)",
    "authors": "Petrenko, Lotov, Sosedkin",
    "doi": "10.1016/j.nima.2016.01.063",
    "arxiv": "1511.04360",
    "me": null
  },
  "PoP.20.013102": {
    "title": "Effect of plasma inhomogeneity on plasma wakefield acceleration driven by long bunches",
    "ref": "Lotov, Pukhov, Caldwell, Phys. Plasmas 20, 013102 (2013)",
    "authors": "Lotov, Pukhov, Caldwell",
    "doi": "10.1063/1.4773905",
    "arxiv": "1205.3388",
    "me": null
  },
  "PRL.107.145003": {
    "title": "Phase Velocity and Particle Injection in a Self-Modulated Proton-Driven Plasma Wakefield Accelerator",
    "ref": "Pukhov et al., PRL 107, 145003 (2011)",
    "authors": "Pukhov, Kumar, Tückmantel, Upadhyay, Lotov",
    "doi": "10.1103/PhysRevLett.107.145003",
    "arxiv": "1108.0071",
    "me": null
  },
  "PoP.22.123107": {
    "title": "Effect of beam emittance on self-modulation of long beams in plasma wakefield accelerators",
    "ref": "Lotov, Phys. Plasmas 22, 123107 (2015)",
    "authors": "Lotov",
    "doi": "10.1063/1.4936973",
    "arxiv": "1510.02692",
    "me": null
  },
  "PoP.24.023119": {
    "title": "Radial equilibrium of relativistic particle bunches in plasma wakefield accelerators",
    "ref": "Lotov, Phys. Plasmas 24, 023119 (2017)",
    "authors": "Lotov",
    "doi": "10.1063/1.4977058",
    "arxiv": "1611.00870",
    "me": null
  },
  "PoP.25.063108": {
    "title": "Response of narrow cylindrical plasmas to dense charged particle beams",
    "ref": "Gorn, Tuev, Petrenko, Sosedkin, Lotov, Phys. Plasmas 25, 063108 (2018)",
    "authors": "Gorn, Tuev, Petrenko, Sosedkin, Lotov",
    "doi": "10.1063/1.5039803",
    "arxiv": "1804.10744",
    "me": "first"
  },
  "PRL.112.194801": {
    "title": "Long-Term Evolution of Broken Wakefields in Finite-Radius Plasmas",
    "ref": "Lotov, Sosedkin, Petrenko, PRL 112, 194801 (2014)",
    "authors": "Lotov, Sosedkin, Petrenko",
    "doi": "10.1103/PhysRevLett.112.194801",
    "arxiv": "1402.1261",
    "me": null
  },
  "PoP.29.023104": {
    "title": "Generation of plasma electron halo by a charged particle beam in a low density plasma",
    "ref": "Gorn & Lotov, Phys. Plasmas 29, 023104 (2022)",
    "authors": "Gorn, Lotov",
    "doi": "10.1063/5.0080675",
    "arxiv": null,
    "me": "first"
  },
  "PPCF.60.024002": {
    "title": "Stable bunch trains for plasma wakefield acceleration",
    "ref": "Lotov, PPCF 60, 024002 (2018)",
    "authors": "Lotov",
    "doi": "10.1088/1361-6587/aa9f97",
    "arxiv": "1711.07633",
    "me": null
  },
  "PoP.20.083108": {
    "title": "Excitation of two-dimensional plasma wakefields by trains of equidistant particle bunches",
    "ref": "Lotov, Phys. Plasmas 20, 083108 (2013)",
    "authors": "Lotov",
    "doi": "10.1063/1.4819720",
    "arxiv": "1307.3812",
    "me": null
  },
  "PRSTAB.16.041301": {
    "title": "Natural noise and external wakefield seeding in a proton-driven plasma accelerator",
    "ref": "Lotov et al., PRSTAB 16, 041301 (2013)",
    "authors": "Lotov, Lotova, Upadhyay, Tückmantel, Pukhov",
    "doi": "10.1103/PhysRevSTAB.16.041301",
    "arxiv": "1204.3444",
    "me": null
  },
  "PoP.24.103129": {
    "title": "Generation of controllable plasma wakefield noise in particle-in-cell simulations",
    "ref": "Moschüring et al., Phys. Plasmas 24, 103129 (2017)",
    "authors": "Moschüring, Ruhl, Spitsyn, Lotov",
    "doi": "10.1063/1.4986399",
    "arxiv": "1706.00594",
    "me": null
  },
  "PoP.24.103114": {
    "title": "Multi-proton bunch driven hollow plasma wakefield acceleration in the nonlinear regime",
    "ref": "Li et al., Phys. Plasmas 24, 103114 (2017)",
    "authors": "Li, Xia, Lotov, Sosedkin, Hanahoe, Mete-Apsimon",
    "doi": "10.1063/1.4995354",
    "arxiv": "1707.03193",
    "me": null
  },
  "PoP.21.083107": {
    "title": "Parameter sensitivity of plasma wakefields driven by self-modulating proton beams",
    "ref": "Lotov, Minakov, Sosedkin, Phys. Plasmas 21, 083107 (2014)",
    "authors": "Lotov, Minakov, Sosedkin",
    "doi": "10.1063/1.4892183",
    "arxiv": "1405.1825",
    "me": null
  },
  "PRL.43.267": {
    "title": "Laser Electron Accelerator",
    "ref": "Tajima et al., Phys. Rev. Lett. 43, 267 (1979)",
    "authors": "Tajima, Dawson",
    "doi": "10.1103/PhysRevLett.43.267",
    "arxiv": null,
    "me": null
  },
  "arXiv.2401.11924": {
    "title": "LCODE: Quasistatic code for simulating long-term evolution of three-dimensional plasma wakefields",
    "ref": "Kargapolov et al. (2024)",
    "authors": "Kargapolov, Okhotnikov, Shalimova, Sosedkin, Lotov",
    "doi": null,
    "arxiv": "2401.11924",
    "me": null
  },
  "arXiv.1511.04193": {
    "title": "LCODE: a parallel quasistatic code for computationally heavy problems of plasma wakefield acceleration",
    "ref": "Sosedkin et al. (2015)",
    "authors": "Sosedkin, Lotov",
    "doi": "10.1016/j.nima.2015.12.032",
    "arxiv": "1511.04193",
    "me": null
  }
};
