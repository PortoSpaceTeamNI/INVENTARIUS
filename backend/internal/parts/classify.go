package parts

import (
	"regexp"
	"strings"
)

// Mouser's API has no package field, so the footprint is read from the
// description ("... 16v, 0402", "MOSFETs SOT-23 N-CH") or, for families
// whose part numbers encode it, from the part number.

var descPackage = regexp.MustCompile(`(?i)\b(` +
	`01005|0201|0402|0603|0805|1206|1210|1812|2010|2512|` +
	`SOT-?(?:23(?:-\d)?|223|323|353|363|563|89)|SC-?70(?:-\d)?|SOD-?(?:123F?|323F?|523|923)|` +
	`DO-?(?:214A[ABC]|41|35|15)|TO-?(?:220(?:AB|F)?|247|252|263|92|3|5|39|46)|D2?PAK|` +
	`(?:P?DIP|SOIC|SOP|SSOP|TSSOP|MSOP|VSSOP|QSOP|HTSSOP|QFN|VQFN|WQFN|UQFN|DFN|WSON|SON|LQFP|TQFP|QFP|LGA|BGA|TFBGA|WLCSP|LCC)-?\d+` +
	`)\b`)

// Chip size prefixes of common passive part numbers.
var mpnPackage = []struct {
	re   *regexp.Regexp
	pkgs map[string]string // matched size code -> package
}{
	// Samsung MLCC: CL05 = 0402, CL10 = 0603, ...
	{regexp.MustCompile(`^CL(03|05|10|21|31|32)[A-Z]`), map[string]string{
		"03": "0201", "05": "0402", "10": "0603", "21": "0805", "31": "1206", "32": "1210"}},
	// Murata MLCC: GRM18 = 0603, GCM15 = 0402, ...
	{regexp.MustCompile(`^G[RC]M(03|15|18|21|31|32)`), map[string]string{
		"03": "0201", "15": "0402", "18": "0603", "21": "0805", "31": "1206", "32": "1210"}},
	// TDK: C1005 = 0402, C1608 = 0603, ... (metric size; TDK's C0603 is left
	// out: KEMET's C0603 is an imperial 0603).
	{regexp.MustCompile(`^C(1005|1608|2012|3216|3225)[A-Z]`), map[string]string{
		"1005": "0402", "1608": "0603", "2012": "0805", "3216": "1206", "3225": "1210"}},
	// Yageo RC/AC/CC/AF, KEMET C, Vishay CRCW: the imperial size in the name.
	{regexp.MustCompile(`^(?:RC|AC|AF|CC|RT|C|CRCW)(0201|0402|0603|0805|1206|1210|2010|2512)`), nil},
	// Panasonic ERJ-2 = 0402, ERJ-3 = 0603, ...
	{regexp.MustCompile(`^ERJ-?(14|1|2|3|6|8)`), map[string]string{
		"1": "0201", "2": "0402", "3": "0603", "6": "0805", "8": "1206", "14": "1210"}},
}

// STM32 order codes: STM32F405RGT6 -> pins R (64), package T (LQFP).
var (
	stm32     = regexp.MustCompile(`^STM32[A-Z]{1,2}\d{2,3}([FGKTSCRMVZIBNA])[0-9A-Z]([TUHYP])\d`)
	stm32Pins = map[string]string{"F": "20", "G": "28", "K": "32", "T": "36", "S": "44", "C": "48",
		"R": "64", "M": "80", "V": "100", "Z": "144", "I": "176", "B": "208", "N": "216", "A": "169"}
	stm32Pkg = map[string]string{"T": "LQFP", "U": "QFN", "H": "BGA", "Y": "WLCSP", "P": "TSSOP"}
)

// Footprint guesses the package of a part, or returns "".
func Footprint(mpn, description string) string {
	if m := descPackage.FindString(description); m != "" {
		return strings.ToUpper(m)
	}
	mpn = strings.ToUpper(strings.TrimSpace(mpn))
	for _, p := range mpnPackage {
		if m := p.re.FindStringSubmatch(mpn); m != nil {
			if p.pkgs == nil {
				return m[1]
			}
			return p.pkgs[m[1]]
		}
	}
	if m := stm32.FindStringSubmatch(mpn); m != nil {
		if pkg, pins := stm32Pkg[m[2]], stm32Pins[m[1]]; pkg != "" && pins != "" {
			return pkg + "-" + pins
		}
	}
	return ""
}

// Group is a kind of component, for choosing the item's category.
type Group struct {
	// Name for a new category (Portuguese, like the rest of the team's data).
	Name string
	// Names an existing category may already have, in Portuguese or
	// English, lower case without accents.
	Names []string
}

var groups = []struct {
	words []string // in Mouser's category, lower case
	group Group
}{
	// Before ICs: "Clock Oscillators" are crystals, not ICs.
	{[]string{"crystal", "oscillator", "resonator"}, Group{"Cristais e osciladores",
		[]string{"cristais e osciladores", "cristais", "cristal", "osciladores", "crystals", "crystal", "oscillators", "crystals & oscillators"}}},
	// Before LEDs and switches: "LED Drivers" and "Analog Switch ICs" are ICs.
	{[]string{"driver", "switch ic"}, icGroup},
	{[]string{"led"}, Group{"LEDs", []string{"leds", "led"}}},
	// Before sensors: "Current Sense Resistors".
	{[]string{"resistor", "potentiometer", "trimmer"}, Group{"Resistências",
		[]string{"resistencias", "resistencia", "resistores", "resistor", "resistors"}}},
	{[]string{"capacitor"}, Group{"Condensadores",
		[]string{"condensadores", "condensador", "capacitores", "capacitor", "capacitors"}}},
	{[]string{"inductor", "ferrite", "choke"}, Group{"Indutores",
		[]string{"indutores", "indutor", "bobinas", "inductors", "inductor"}}},
	{[]string{"diode", "rectifier", "tvs", "esd", "zener"}, Group{"Díodos",
		[]string{"diodos", "diodo", "diodes", "diode"}}},
	{[]string{"mosfet", "transistor", "igbt", "jfet"}, Group{"Transístores",
		[]string{"transistores", "transistor", "transistors"}}},
	{[]string{"microcontroller", "mcu", "microprocessor", "fpga", "processor"}, Group{"Microcontroladores",
		[]string{"microcontroladores", "microcontrolador", "microcontrollers", "microcontroller", "mcus", "mcu"}}},
	{[]string{"regulator", "ldo", "dc-dc", "dc/dc", "switching", "power management", "voltage reference"}, Group{"Reguladores de tensão",
		[]string{"reguladores de tensao", "reguladores", "regulador", "voltage regulators", "regulators", "regulator"}}},
	{[]string{"sensor", "accelerometer", "gyroscope", "imu", "magnetometer", "thermistor"}, Group{"Sensores",
		[]string{"sensores", "sensor", "sensors"}}},
	{[]string{"connector", "header", "terminal block", "socket", "housing", "contact"}, Group{"Conectores",
		[]string{"conectores", "conector", "connectors", "connector"}}},
	{[]string{"fuse", "ptc", "resettable"}, Group{"Fusíveis",
		[]string{"fusiveis", "fusivel", "fuses", "fuse"}}},
	{[]string{"relay"}, Group{"Relés", []string{"reles", "rele", "relays", "relay"}}},
	{[]string{"switch"}, Group{"Interruptores",
		[]string{"interruptores", "interruptor", "botoes", "switches", "switch"}}},
	{[]string{"batter"}, Group{"Baterias", []string{"baterias", "bateria", "batteries", "battery"}}},
	{[]string{"wire", "cable"}, Group{"Cabos e fios", []string{"cabos e fios", "cabos", "fios", "cables", "wires", "wire"}}},
	{[]string{"antenna", "rf "}, Group{"RF e antenas", []string{"rf e antenas", "rf", "antenas", "antennas"}}},
	{[]string{"amplifier", "comparator", "logic", "interface", "memory", "eeprom", "flash", "adc", "dac",
		"data converter", "timer", "clock", "multiplexer", "transceiver", "ic"}, icGroup},
}

var icGroup = Group{"Circuitos integrados",
	[]string{"circuitos integrados", "circuito integrado", "integrated circuits", "ics", "ic", "chips"}}

// GroupOf maps a distributor category ("Multilayer Ceramic Capacitors MLCC -
// SMD/SMT") to a group, or nil if none fits.
func GroupOf(category string) *Group {
	c := strings.ToLower(category)
	for _, g := range groups {
		for _, w := range g.words {
			if containsWord(c, w) {
				return &g.group
			}
		}
	}
	return nil
}

// containsWord reports whether w starts a word in s ("ic" matches "ICs" but
// not "Ceramic").
func containsWord(s, w string) bool {
	for i := 0; ; {
		j := strings.Index(s[i:], w)
		if j < 0 {
			return false
		}
		j += i
		if j == 0 || !isLetter(s[j-1]) {
			return true
		}
		i = j + 1
	}
}

func isLetter(b byte) bool { return b >= 'a' && b <= 'z' }

// Values in descriptions, e.g. "X6S, 1uF, +/-10%, 16v, 0402" or
// "Chip Resistor 0603, 10kOhms, 1%, 1/10W".
var (
	capValue = regexp.MustCompile(`(?i)\b(\d+(?:\.\d+)?)\s*([pnuµμm]?)F\b`)
	resValue = regexp.MustCompile(`(?i)\b(\d+(?:\.\d+)?)\s*([kKmM]?)\s*(?:ohms?|Ω)`)
	indValue = regexp.MustCompile(`(?i)\b(\d+(?:\.\d+)?)\s*([nuµμm]?)H\b`)
	ledColor = regexp.MustCompile(`(?i)\b(red|green|blue|yellow|white|orange|amber|pink|purple|rgb|ir|infrared|uv)\b`)
)

// ShortLabel is a short text for labels: what it is, value and package for
// passives ("Capacitors 1uF 0402", "Resistors 10k 0603"), colour and package
// for LEDs, and the part number for everything else ("STM32F405RGT6").
func ShortLabel(p Part, g *Group) string {
	d := p.Description
	var words []string
	add := func(w string) {
		if w != "" {
			words = append(words, w)
		}
	}
	name := ""
	if g != nil {
		name = g.Name
	}
	switch name {
	case "Condensadores":
		if m := capValue.FindStringSubmatch(d); m != nil {
			add("Capacitors")
			add(m[1] + unitPrefix(m[2]) + "F")
		}
	case "Resistências":
		if m := resValue.FindStringSubmatch(d); m != nil {
			add("Resistors")
			switch strings.ToLower(m[2]) {
			case "k":
				add(m[1] + "k")
			case "m":
				add(m[1] + "M")
			default:
				add(m[1] + "R")
			}
		}
	case "Indutores":
		if m := indValue.FindStringSubmatch(d); m != nil {
			add("Inductors")
			add(m[1] + unitPrefix(m[2]) + "H")
		}
	case "LEDs":
		if c := ledColor.FindString(d); c != "" {
			add("LED " + strings.ToUpper(c[:1]) + strings.ToLower(c[1:]))
		}
	}
	if len(words) == 0 {
		// Nothing read from the description: the part number says it best.
		return p.MPN
	}
	add(p.Package)
	return strings.Join(words, " ")
}

func unitPrefix(s string) string {
	switch s {
	case "µ", "μ", "U":
		return "u"
	case "P", "N":
		return strings.ToLower(s)
	}
	return s
}
