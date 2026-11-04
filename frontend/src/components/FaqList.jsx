import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Stagger, StaggerItem } from '../motion';
import { useContent } from '../lib/site';

export default function FaqList() {
  const { faqs } = useContent().shared;
  return (
    <Stagger as="ul" className="faq-list" stagger={0.06}>
      {faqs.map((item, i) => (
        <StaggerItem as="li" key={i} className="faq-list__item" distance={12} duration={0.5}>
          <h3 className="faq-list__question">
            {item.to ? (
              <Link to={item.to}>
                {item.question}
                <ArrowUpRight size={18} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            ) : (
              item.question
            )}
          </h3>
          <p className="faq-list__answer">{item.answer}</p>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
