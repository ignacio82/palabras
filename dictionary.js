// dictionary.js
const DICTIONARY_DATA = [
    // --- Palabras Fáciles ---
    { word: "SOL", definition: "Estrella grande que nos da luz y calor durante el día.", difficulty: "easy" },
    { word: "GATO", definition: "Animal doméstico que hace 'miau' y le gusta jugar.", difficulty: "easy" },
    { word: "FLOR", definition: "Parte bonita y colorida de una planta, a veces con rico olor.", difficulty: "easy" },
    { word: "CASA", definition: "Lugar donde vivimos con nuestra familia.", difficulty: "easy" },
    { word: "LUNA", definition: "Aparece en el cielo de noche y brilla.", difficulty: "easy" },
    { word: "PATO", definition: "Ave que nada en el agua y hace 'cuac cuac'.", difficulty: "easy" },
    { word: "MESA", definition: "Mueble con una tabla encima donde comemos o dibujamos.", difficulty: "easy" },
    { word: "AGUA", definition: "Líquido transparente que bebemos y usamos para bañarnos.", difficulty: "easy" },
    { word: "ROJO", definition: "Color como el de una manzana o un tomate.", difficulty: "easy" },
    { word: "NIÑO", definition: "Un chico pequeño.", difficulty: "easy" },
    { word: "MANO", definition: "Parte del cuerpo con cinco dedos para agarrar cosas.", difficulty: "easy" },
    { word: "PIE", definition: "Parte del cuerpo que usamos para caminar y tiene dedos.", difficulty: "easy" },
    { word: "OJO", definition: "Parte de la cara que usamos para ver.", difficulty: "easy" },
    { word: "PAN", definition: "Alimento hecho con harina que comemos en sándwiches o tostadas.", difficulty: "easy" },
    { word: "PERRO", definition: "Animal amigo del hombre que hace 'guau guau'.", difficulty: "easy" },

    // --- Palabras Medianas ---
    { word: "MANZANA", definition: "Fruta redonda y jugosa, puede ser roja, verde o amarilla.", difficulty: "medium" },
    { word: "LIBRO", definition: "Conjunto de hojas con historias o dibujos para leer.", difficulty: "medium" },
    { word: "SILLA", definition: "Mueble que usamos para sentarnos.", difficulty: "medium" },
    { word: "JIRAFA", definition: "Animal muy alto con el cuello largo y manchas.", difficulty: "medium" },
    { word: "TREN", definition: "Transporte largo que viaja sobre rieles y hace 'chu chu'.", difficulty: "medium" },
    { word: "VERDE", definition: "Color como el del pasto o las hojas de los árboles.", difficulty: "medium" },
    { word: "AZUL", definition: "Color como el del cielo en un día soleado o el mar.", difficulty: "medium" },
    { word: "FELIZ", definition: "Sentimiento de alegría y contentura.", difficulty: "medium" },
    { word: "ESCUELA", definition: "Lugar donde los niños van a aprender.", difficulty: "medium" },
    { word: "ARBOL", definition: "Planta grande con tronco, ramas y hojas.", difficulty: "medium" }, // Árbol - will be uppercased
    { word: "PELOTA", definition: "Objeto redondo que usamos para jugar, patear o lanzar.", difficulty: "medium" },
    { word: "AMIGO", definition: "Persona especial con la que te diviertes y confías.", difficulty: "medium" },
    { word: "HELADO", definition: "Postre frío y dulce que viene en muchos sabores.", difficulty: "medium" },
    { word: "PLAYA", definition: "Lugar con arena y mar donde vamos a jugar y tomar sol.", difficulty: "medium" },
    { word: "PUERTA", definition: "Se usa para entrar o salir de una habitación o casa.", difficulty: "medium" },

    // --- Palabras Difíciles ---
    { word: "BICICLETA", definition: "Vehículo de dos ruedas que se mueve cuando pedaleas.", difficulty: "hard" },
    { word: "ELEFANTE", definition: "Animal muy grande con trompa larga y orejas grandes.", difficulty: "hard" },
    { word: "COMPUTADORA", definition: "Máquina que usamos para escribir, jugar y buscar información.", difficulty: "hard" },
    { word: "DINOSAURIO", definition: "Animal muy antiguo que ya no existe, algunos eran gigantes.", difficulty: "hard" },
    { word: "MARIPOSA", definition: "Insecto con alas grandes y coloridas que vuela entre las flores.", difficulty: "hard" },
    { word: "CHOCOLATE", definition: "Dulce delicioso hecho con cacao, puede ser en barra o bombón.", difficulty: "hard" },
    { word: "OCEANO", definition: "Una enorme cantidad de agua salada, más grande que un mar.", difficulty: "hard" }, // Océano
    { word: "CASTILLO", definition: "Construcción grande y fuerte donde vivían reyes y reinas.", difficulty: "hard" },
    { word: "TELESCOPIO", definition: "Instrumento para ver cosas que están muy lejos, como las estrellas.", difficulty: "hard" },
    { word: "AVENTURA", definition: "Una experiencia emocionante y a veces arriesgada.", difficulty: "hard" },
    { word: "MUSICA", definition: "Sonidos organizados que son agradables de escuchar.", difficulty: "hard" }, // Música
    { word: "ESTRELLA", definition: "Punto brillante en el cielo nocturno, como el Sol pero muy lejano.", difficulty: "hard" },
    { word: "EXPLORADOR", definition: "Persona que viaja a lugares desconocidos para descubrir cosas nuevas.", difficulty: "hard" },
    { word: "CIENCIA", definition: "Estudio de cómo funcionan las cosas en el mundo y el universo.", difficulty: "hard" },
    { word: "IMAGINACION", definition: "Capacidad de crear ideas e imágenes en la mente.", difficulty: "hard" } // Imaginación
];