// OCR local con el framework Vision de macOS.
//
// Por qué existe: hoy la imagen del comprobante viaja COMPLETA al proveedor de
// IA (el OCR es remoto), y la seudonimización de identidad opera sobre texto,
// no sobre píxeles — o sea que el RUT y el nombre del tercero salen en la foto.
// Vision corre EN LA MÁQUINA: no hay encargado de tratamiento, no hay
// transferencia internacional y no hay nada que declarar, porque los datos no
// salen. Es la misma jugada que el cifrado local de la extensión del SII.
//
// Uso:  ocr <imagen> [imagen...]
// Sale: JSON por stdout — [{"file":…,"lines":[…],"text":…,"confianza":…}]

import Foundation
import Vision
import AppKit

struct Salida: Codable {
    let file: String
    let lines: [String]
    let text: String
    let confianza: Double
    let ms: Int
}

func ocr(_ path: String) -> Salida? {
    let inicio = Date()
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("no pude abrir: \(path)\n".data(using: .utf8)!)
        return nil
    }

    let req = VNRecognizeTextRequest()
    // .accurate sobre .fast: las capturas de Binance/banco traen texto chico y
    // montos donde confundir un dígito cambia la boleta.
    req.recognitionLevel = .accurate
    // es-CL primero; en-US de respaldo porque las apps de exchange mezclan
    // inglés ("Completed", "Release") con español.
    req.recognitionLanguages = ["es-CL", "es", "en-US"]
    // Corrección de idioma APAGADA: "corrige" RUTs, montos y alias hacia
    // palabras del diccionario, que es justo lo que no queremos.
    req.usesLanguageCorrection = false

    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch {
        FileHandle.standardError.write("vision fallo en \(path): \(error)\n".data(using: .utf8)!)
        return nil
    }

    let obs = req.results ?? []

    // Vision devuelve los fragmentos en su propio orden y NO reconstruye filas:
    // en un comprobante de dos columnas escupe primero todas las etiquetas
    // ("Destinatario", "RUT", "Banco") y después todos los valores, con lo que
    // se pierde qué valor va con qué etiqueta. Para extraer campos de forma
    // determinista eso es fatal, así que las filas se rearman con la geometría:
    // se agrupan los fragmentos cuyo centro vertical cae en la misma banda y se
    // ordenan de izquierda a derecha. El alto del propio fragmento da la
    // tolerancia, así sirve igual en una captura chica que en uno grande.
    struct Frag { let s: String; let midY: Double; let minX: Double; let alto: Double; let conf: Double }
    var frags: [Frag] = []
    for o in obs {
        guard let top = o.topCandidates(1).first else { continue }
        let b = o.boundingBox
        frags.append(Frag(s: top.string, midY: b.midY, minX: b.minX, alto: b.height, conf: Double(top.confidence)))
    }
    // boundingBox tiene el origen ABAJO a la izquierda: midY mayor = más arriba.
    frags.sort { $0.midY > $1.midY }

    var lineas: [String] = []
    var fila: [Frag] = []
    func cerrarFila() {
        guard !fila.isEmpty else { return }
        lineas.append(fila.sorted { $0.minX < $1.minX }.map(\.s).joined(separator: "  "))
        fila = []
    }
    for f in frags {
        if let ref = fila.first {
            let tolerancia = max(ref.alto, f.alto) * 0.6
            if abs(ref.midY - f.midY) > tolerancia { cerrarFila() }
        }
        fila.append(f)
    }
    cerrarFila()

    let suma = frags.reduce(0.0) { $0 + $1.conf }
    let conf = frags.isEmpty ? 0 : suma / Double(frags.count)
    return Salida(
        file: (path as NSString).lastPathComponent,
        lines: lineas,
        text: lineas.joined(separator: "\n"),
        confianza: (conf * 1000).rounded() / 1000,
        ms: Int(Date().timeIntervalSince(inicio) * 1000)
    )
}

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    FileHandle.standardError.write("uso: ocr <imagen> [imagen...]\n".data(using: .utf8)!)
    exit(2)
}
let salidas = args.compactMap(ocr)
let enc = JSONEncoder()
enc.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
FileHandle.standardOutput.write(try! enc.encode(salidas))
print()
exit(salidas.count == args.count ? 0 : 1)
