// config/config.js
const cfg = {
  endpoints: {
    // Usá SIEMPRE esta base con ?action=
    login:  "https://script.google.com/macros/s/AKfycbxRcJBwiduLWnfRaGJl0UaTH0bIk0bmi2KLtgmEG20jG6j08Srrg5mluFpTylik1THdfA/exec?action=login",
    viandas:"https://script.google.com/macros/s/AKfycbxRcJBwiduLWnfRaGJl0UaTH0bIk0bmi2KLtgmEG20jG6j08Srrg5mluFpTylik1THdfA/exec?action=viandas",
    pedido: "https://script.google.com/macros/s/AKfycbxRcJBwiduLWnfRaGJl0UaTH0bIk0bmi2KLtgmEG20jG6j08Srrg5mluFpTylik1THdfA/exec?action=pedido"
  },
  origin: "https://pedidos.amaranta.ar",
  recaptchaSiteKey: "" // si vas a usar reCAPTCHA, poné tu site key acá
};
export default cfg;
